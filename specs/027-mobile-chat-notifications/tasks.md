# Tasks: Mobile Chat & Notification Parity

**Input**: Design documents from `/specs/027-mobile-chat-notifications/`  
**Branch**: `027-mobile-chat-notifications`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US7)
- File paths are relative to `frontend/apps/mobile/`

---

## Phase 1: Setup (Native Dependency)

**Purpose**: Install `@expo/ui` so SwiftUI List components are available for iOS sidebar.

- [X] T001 Add `@expo/ui` to `package.json` via `npx expo install @expo/ui` (run from `frontend/apps/mobile/`); commit updated `package.json` and `pnpm-lock.yaml`
- [X] T002 Verify `(app)/(chat)/_layout.tsx` has a `search` route slot with `presentation: 'modal'` ready to be added (read file; note current state for T017)

**Checkpoint**: `@expo/ui` in package.json; native rebuild (`npx expo run:ios`) unblocked

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared utilities and provider changes that multiple user stories depend on.

**⚠️ CRITICAL**: Complete before starting any user story.

- [X] T003 [P] Create `groupChannelsByTime` utility in `src/utils/group-channels.ts` — accepts `ChannelWithDetails[]`, returns `SidebarSection[]` bucketed into `'Today' | 'This Week' | 'Earlier'` using `date-fns` `isToday` / `isThisWeek`; omit empty sections (see contracts/api-contracts.md for exact signature)
- [X] T004 [P] Update `presence` SSE event case in `src/providers/notification-stream-provider.tsx` to call `queryClient.setQueryData(['presence', employeeId], { employeeId, status, lastInteractionAt: new Date(), lastHeartbeat: new Date() })` instead of broad `invalidateQueries`; verify payload field name (`employee_id` snake_case) against backend by running `docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "select * from notification.active_connection limit 1"` and checking `publisher.go`

**Checkpoint**: Foundation ready — all user story phases can now begin

---

## Phase 3: User Story 1 — Real-Time Messages Arrive Without Refresh (Priority: P1) 🎯 MVP

**Goal**: New messages appear automatically; auto-scroll when at bottom; "↓ New messages" pill when scrolled up.

**Independent Test**: Open a DM. Have another session send a message. Verify it appears without refresh. Scroll up, send another — verify pill appears. Tap pill — verify scroll to bottom.

### Implementation for User Story 1

- [X] T005 [US1] Add `onScroll` handler to `FlatList` in `src/app/(app)/(chat)/[channelId].tsx` that updates `atBottomRef.current` and `atBottom` state when `contentOffset.y < 80` (inverted list y=0 is bottom); also call `setShowNewMessages(false)` when returning to bottom; set `scrollEventThrottle={16}`
- [X] T006 [US1] Render "↓ New messages" pill as an absolute-positioned `Pressable` inside the screen's root `View` in `src/app/(app)/(chat)/[channelId].tsx`; show only when `showNewMessages === true`; on press: `flatListRef.current?.scrollToOffset({ offset: 0, animated: true })` then `setShowNewMessages(false)`; style: bottom = 80 + bottom safe-area inset, centered horizontally, dark rounded pill with white chevron + text
- [X] T007 [US1] Add `testID` props in `src/app/(app)/(chat)/[channelId].tsx`: `testID="new-messages-pill"` on pill `Pressable`, `testID="message-input"` on the `TextInput`, `testID="send-button"` on the send `Pressable`
- [X] T008 [US1] Expand `frontend/apps/mobile/.maestro/chat/send-message.yaml`: after sign-in, navigate to a channel; scroll up (swipe gesture); trigger a new message event (or use a second flow); assert `testID="new-messages-pill"` is visible; tap it; assert pill is gone and most-recent message row is visible

**Checkpoint**: User Story 1 fully functional — real-time messages with pill indicator working on device

---

## Phase 4: User Story 2 — Load Older Messages by Scrolling Up (Priority: P1)

**Goal**: Scrolling to the top fetches older messages and prepends without any viewport jump. Loading indicator visible during fetch; no spinner when history exhausted.

**Independent Test**: Open a channel with >30 messages. Scroll up past the first page. Verify new messages load seamlessly and the previously visible message remains at the same visual position.

### Implementation for User Story 2

- [X] T009 [US2] Add `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` prop to `FlatList` in `src/app/(app)/(chat)/[channelId].tsx`; confirm it's placed before `data` prop for readability
- [X] T010 [P] [US2] Add a loading indicator at the visual top of the message list in `src/app/(app)/(chat)/[channelId].tsx`: use `ListFooterComponent` (footer renders at visual top in an inverted list) — render an `ActivityIndicator` when `isFetchingNextPage` is true, nothing otherwise
- [X] T011 [P] [US2] Guard the `onEndReached` callback in `src/app/(app)/(chat)/[channelId].tsx` so it only calls `fetchNextPage()` when `hasNextPage && !isFetchingNextPage`; set `onEndReachedThreshold={0.3}`

**Checkpoint**: User Stories 1 and 2 fully functional — real-time + prepend scroll both working

---

## Phase 5: User Story 3 — Chat Sidebar: Recents Grouped by Time (Priority: P1)

**Goal**: Sidebar displays time-bucketed groups (Today / This Week / Earlier). On iOS uses SwiftUI `List` with native inset-grouped style. Updates live from SSE.

**Independent Test**: Open Chat tab. Verify sections "Today", "This Week", "Earlier" appear. Receive a new message — verify that channel moves to the correct time bucket without manual refresh.

### Implementation for User Story 3

- [X] T012 [US3] Import `groupChannelsByTime` from `src/utils/group-channels.ts` in `src/app/(app)/(chat)/index.tsx`; replace the current `dms` / `groups` flat split with a call to `groupChannelsByTime(channels)` to produce `SidebarSection[]`
- [X] T013 [US3] Implement Platform-branched sidebar render in `src/app/(app)/(chat)/index.tsx`:
  - iOS (`Platform.OS === 'ios'`): import `{ List, Section }` from `@expo/ui/swift-ui`; render `<List listStyle='insetGrouped' refreshable={{ onRefresh: refetch, isRefreshing: isRefetching }}>` with `sections.map(s => <Section key={s.title} header={s.title}><List.ForEach data={s.data} id={ch => ch.channel.id}>{ch => <ChannelRow ... />}</List.ForEach></Section>)`
  - Android/other: existing `SectionList` with updated `sections` from `groupChannelsByTime` result; keep `RefreshControl` and `renderSectionHeader`
- [X] T014 [P] [US3] Add `testID={`channel-row-${item.channel.id}`}` to the `Pressable` in the `ChannelRow` component in `src/app/(app)/(chat)/index.tsx`; add `testID="new-channel-button"` and `testID="new-dm-button"` to the header icon buttons
- [X] T015 [P] [US3] Remove the now-obsolete section header `Channels` create-button (the `+` icon inside `renderSectionHeader` for type-based "Channels" section) since the time-bucket headers don't have per-type actions; keep the global header `new-channel` and `new-dm` buttons
- [X] T016 [US3] Expand Maestro `frontend/apps/mobile/.maestro/chat/channel-list.yaml`: assert "Today" section header text is visible (if test data has same-day channels); assert `testID="channel-row-*"` element exists; perform pull-to-refresh gesture; assert list reloads

**Checkpoint**: US1, US2, and US3 all functional — full P1 scope complete

---

## Phase 6: User Story 4 — Smart Channel/DM Search and Create (Priority: P2)

**Goal**: Full-screen search modal from chat tab header; instant local filter → debounced server search → employee DM suggestions.

**Independent Test**: Tap search icon. Type partial channel name — see instant results. Type employee name — see people suggestions. Tap an employee — a new or existing DM opens.

### Implementation for User Story 4

- [X] T017 [US4] Add `<Stack.Screen name="search" options={{ presentation: 'modal', title: 'Search', headerShown: true }} />` to `src/app/(app)/(chat)/_layout.tsx`
- [X] T018 [US4] Create `src/app/(app)/(chat)/search.tsx`: full-screen modal with `TextInput` (`testID="search-input"`, `autoFocus`, placeholder "Search channels or people"), `FlatList` for results, and a Cancel button that calls `router.back()`
- [X] T019 [P] [US4] Implement instant local channel filter in `src/app/(app)/(chat)/search.tsx`: on `query` change, call `queryClient.getQueryData<ChannelWithDetails[]>(['recentChannels'])` and filter by display name / titleSlug containing query (case-insensitive); display as "Channels" section in results `FlatList` with `testID={`search-result-channel-${ch.channel.id}`}` on each row
- [X] T020 [P] [US4] Add debounced (300ms) `searchChannels(query)` API call in `src/app/(app)/(chat)/search.tsx` using `useQuery` with `queryKey: ['search-channels', query]`, `enabled: query.length > 0`, `staleTime: 0`; merge server results below local filter results, deduplicating by channel ID
- [X] T021 [US4] Add `searchEmployees(query)` API call in `src/app/(app)/(chat)/search.tsx` triggered when total channel results < 3 and query.length > 0; display as "People" section with `testID={`search-result-employee-${emp.id}`}`; exclude the current user (compare `emp.id` against auth context `employeeId`)
- [X] T022 [US4] Handle employee row tap in `src/app/(app)/(chat)/search.tsx`: call `createDirectMessage({ employeeId: emp.id })`, then `router.replace({ pathname: '/(app)/(chat)/[channelId]', params: { channelId: result.channel.id } })`; show loading state on the tapped row during the API call
- [X] T023 [P] [US4] Add search icon button to `index.tsx` header via `Stack.Screen headerRight`, with `testID="search-icon-button"` and `onPress={() => router.push('/(app)/(chat)/search')}`; use SF Symbol `"sf:magnifyingglass"` image
- [X] T024 [US4] Create Maestro `frontend/apps/mobile/.maestro/chat/smart-search.yaml`: sign in → tap `testID="search-icon-button"` → assert search modal visible (search input visible) → type partial channel name → assert `search-result-channel-*` visible → clear → type employee name → assert `search-result-employee-*` visible → tap employee → assert navigated to DM channel (`testID="channel-header-title"` visible)

**Checkpoint**: Search modal fully functional end-to-end

---

## Phase 7: User Story 5 — Online Status Shown on DM Avatars (Priority: P2)

**Goal**: Presence dots on DM rows reflect live online/away/offline status. App sends own status on foreground/background transitions.

**Independent Test**: Open DM list. Verify colored dots appear on DM avatars. Change the contact's status in another session — dot updates within 5 seconds.

### Implementation for User Story 5

- [X] T025 [P] [US5] Create `src/hooks/use-presence.ts`: exports `usePresence(employeeId: string | undefined): PresenceStatus | null` using `useQuery({ queryKey: ['presence', employeeId], queryFn: () => getEmployeePresence(employeeId!), enabled: !!employeeId, staleTime: 60_000, select: p => p?.status ?? null })`; import `getEmployeePresence` and `PresenceStatus` from `apis`
- [X] T026 [P] [US5] Create `src/hooks/use-app-state-presence.ts`: exports `useAppStatePresence(): void`; uses `AppState.addEventListener('change', handler)`: `nextState === 'active'` → call `updatePresenceStatus({ status: 'online', activeChannelId: null, lastInteractionAt: new Date() })`; `'background' | 'inactive'` → call with `status: 'away'`; debounce to avoid duplicate calls using `lastSentRef`; cleanup on unmount
- [X] T027 [US5] Call `useAppStatePresence()` once inside the default export of `src/app/(app)/_layout.tsx` (the authenticated root layout), after the auth check
- [X] T028 [US5] Wire `usePresence` into `ChannelRow` in `src/app/(app)/(chat)/index.tsx`: pass `otherPersonId` (the non-current-user participant employeeId for DM channels) as prop; call `usePresence(otherPersonId)` inside `ChannelRow`; render `<PresenceIndicator status={presenceStatus} />` overlaid on the `UserAvatar` when `isDM && presenceStatus`; map `PresenceStatus` to colors: `online → '#4caf50'`, `idle → '#ff9800'`, `offline / online_hidden / unspecified → '#9e9e9e'`

**Checkpoint**: Presence dots live and AppState updates firing correctly

---

## Phase 8: User Story 6 — Navigate Between Channel List and Message Thread (Priority: P2)

**Goal**: Tap → push → message view at latest messages. Back → channel list at same scroll. Rapid channel switching resets scroll/unread state correctly.

**Independent Test**: Open channel list. Tap a channel. Verify message list is shown at latest. Press back. Verify channel list is at same position. Open another channel — verify fresh state.

### Implementation for User Story 6

- [X] T029 [P] [US6] Add `testID="channel-header-title"` to the `Stack.Screen title` element (or the `<Text>` showing channel name in a custom header) in `src/app/(app)/(chat)/[channelId].tsx`; add `testID="back-button"` if a custom back button is rendered; verify the existing `useEffect` that resets scroll state on `channelId` change includes `atBottom`, `showNewMessages`, and `lastMessageIdRef`
- [X] T030 [US6] Expand Maestro `frontend/apps/mobile/.maestro/chat/channel-list.yaml` to test navigation: tap `testID="channel-row-*"` → assert `testID="channel-header-title"` visible → press back (Maestro `back` command) → assert `testID="channel-row-*"` visible again (channel list restored)
- [X] T031 [US6] Expand Maestro `frontend/apps/mobile/.maestro/chat/new-dm.yaml`: sign in → tap `testID="new-dm-button"` → fill search → tap employee → assert DM channel opens (`testID="channel-header-title"` visible) → press back → assert channel list visible

**Checkpoint**: Navigation verified E2E; scroll state resets confirmed

---

## Phase 9: User Story 7 — Deep-Link Highlight to Specific Message (Priority: P3)

**Goal**: Notification tap opens channel and highlights the specific message for 3 seconds.

**Independent Test**: Navigate programmatically with `highlightedMessageId` param set to a known message ID in the first page. Verify the message has a distinct background that fades after 3 seconds.

### Implementation for User Story 7

- [X] T032 [US7] Read `highlightedMessageId` from `useLocalSearchParams<{ channelId: string; highlightedMessageId?: string }>()` in `src/app/(app)/(chat)/[channelId].tsx`; store in `const highlightedParam = useLocalSearchParams().highlightedMessageId`
- [X] T033 [US7] Add `const [activeHighlight, setActiveHighlight] = useState<string | null>(null)` in `src/app/(app)/(chat)/[channelId].tsx`; add `useEffect` on `[highlightedParam, channelId]`: if `highlightedParam` is set, call `setActiveHighlight(highlightedParam)` and `setTimeout(() => setActiveHighlight(null), 3000)`; clear on `channelId` change
- [X] T034 [US7] Apply highlight style in `renderItem` / `MessageBubble` in `src/app/(app)/(chat)/[channelId].tsx`: when `item.id === activeHighlight`, add `style={{ backgroundColor: '#fff9c4' }}` (light yellow) to the message container `Pressable`; pass `activeHighlight` down to `MessageBubble` as prop `isHighlighted`
- [X] T035 [US7] Implement scroll-to-highlighted on mount in `src/app/(app)/(chat)/[channelId].tsx`: after data loads (check in `useEffect` on `[messages, activeHighlight]`), if `activeHighlight` and `flatListRef.current` exists, find `index = messages.findIndex(m => m.id === activeHighlight)`; if `index >= 0`, call `flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 })`; guard with `try/catch` (scrollToIndex can throw if item not rendered yet)

**Checkpoint**: All 7 user stories complete — full feature scope delivered

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final testID audit, Maestro smoketest pass, quickstart validation.

- [X] T036 [P] `testID` audit: search all modified files in `src/app/(app)/(chat)/` for `Pressable` and `TextInput` elements missing `testID`; add any that are missing; run grep: `grep -n "Pressable\|TextInput" src/app/\(app\)/\(chat\)/*.tsx | grep -v testID`
- [X] T037 [P] `PresenceIndicator` z-index check: verify `PresenceIndicator` component renders above `UserAvatar` using `position: 'absolute'`, `bottom: 0`, `right: 0` in `src/components/common/presence-indicator.tsx`; read file and confirm existing implementation is correct for this usage
- [X] T038 Run all 4 Maestro flows to confirm green: `channel-list.yaml`, `send-message.yaml`, `new-dm.yaml`, `smart-search.yaml`; document any failures
- [X] T039 Follow `quickstart.md` step-by-step on a clean checkout to verify instructions are accurate; update `quickstart.md` if any step is wrong

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational)          ← T003 and T004 can run in parallel
            ├── Phase 3 (US1 — P1)      ← T005→T006→T007, T008 independent
            ├── Phase 4 (US2 — P1)      ← T009, T010, T011 (T010,T011 parallel)
            ├── Phase 5 (US3 — P1)      ← T012→T013, T014,T015 parallel, T016
            ├── Phase 6 (US4 — P2)      ← T017→T018, T019+T020 parallel, T021→T022, T023 parallel, T024
            ├── Phase 7 (US5 — P2)      ← T025+T026 parallel, T027→T028
            ├── Phase 8 (US6 — P2)      ← T029 parallel, T030→T031
            └── Phase 9 (US7 — P3)      ← T032→T033→T034→T035
                    └── Phase 10 (Polish)
```

### User Story Dependencies

| Story | Priority | Depends On | Can Parallelize With |
|---|---|---|---|
| US1 (real-time pill) | P1 | Phase 2 done | US2, US3 |
| US2 (prepend scroll) | P1 | Phase 2 done | US1, US3 |
| US3 (sidebar groups) | P1 | T003 (Foundational) | US1, US2 |
| US4 (smart search) | P2 | Phase 2 done | US5, US6 |
| US5 (presence dots) | P2 | T004 (Foundational) | US4, US6 |
| US6 (navigation) | P2 | Phase 2 done; US1 for testIDs | US4, US5 |
| US7 (deep-link) | P3 | US1 complete (uses same file + scroll state) | Nothing |

### Within Each Story

- In US3: T012 → T013 (sequential); T014 + T015 parallel; T016 last
- In US4: T017 → T018 → (T019 + T020 parallel) → T021 → T022; T023 parallel; T024 last
- In US5: T025 + T026 parallel; T027 → T028 sequential
- In US7: T032 → T033 → T034 → T035 strictly sequential (all same file, state flows)

---

## Parallel Execution Example: P1 Stories (Maximum Throughput)

Once Phase 2 is complete, three developers can work in parallel:

```
Dev A (US1 + US2): T005 → T006 → T007 → T008 → T009 → T010 → T011
Dev B (US3):       T012 → T013 → T014/T015 parallel → T016
Dev C (foundation check): verify T003/T004 before starting US4/US5
```

---

## Implementation Strategy

**MVP (Phase 1–3)**: Install dependency + foundational utilities + US1 (real-time pill). 
Justification: SC-001 and SC-003 (real-time messages + pill) are the highest trust-building features. Deliverable is visible to any tester with basic chat access.

**Increment 2 (Phase 4–5)**: Add US2 (prepend scroll) + US3 (sidebar grouping).
Justification: Completes all P1 user stories. Chat is then parity with web for core messaging.

**Increment 3 (Phase 6–8)**: US4 (search) + US5 (presence) + US6 (navigation E2E).
Justification: All P2 stories. App becomes a production-quality chat client.

**Increment 4 (Phase 9–10)**: US7 (deep-link highlight) + polish.
Justification: P3 story and final quality pass. Ship-ready.

---

## Summary

| Metric | Count |
|---|---|
| Total tasks | 39 |
| Phase 1 (Setup) | 2 |
| Phase 2 (Foundational) | 2 |
| Phase 3 (US1) | 4 |
| Phase 4 (US2) | 3 |
| Phase 5 (US3) | 5 |
| Phase 6 (US4) | 8 |
| Phase 7 (US5) | 4 |
| Phase 8 (US6) | 3 |
| Phase 9 (US7) | 4 |
| Phase 10 (Polish) | 4 |
| Parallelizable [P] tasks | 16 |
| New files created | 5 (`group-channels.ts`, `use-presence.ts`, `use-app-state-presence.ts`, `search.tsx`, `smart-search.yaml`) |
| Existing files modified | 6 (`[channelId].tsx`, `index.tsx`, `_layout.tsx` (chat), `_layout.tsx` (app root), `notification-stream-provider.tsx`, `channel-list.yaml`, `send-message.yaml`, `new-dm.yaml`) |
| Maestro flows | 4 (3 expanded + 1 new) |
