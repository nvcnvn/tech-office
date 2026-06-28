# Implementation Plan: Mobile Chat & Notification Parity

**Branch**: `027-mobile-chat-notifications` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/027-mobile-chat-notifications/spec.md`

## Summary

Port realtime SSE presence, time-grouped chat sidebar, smart search, and message-list scroll UX (new-messages pill, prepend-without-flicker, deep-link highlight) to the mobile app. No new backend endpoints are required; the existing SSE infrastructure, `listRecentChannels`, `searchChannels`, `searchEmployees`, `getEmployeePresence`, and `updatePresenceStatus` APIs are sufficient. On iOS, the sidebar is rendered with `@expo/ui/swift-ui` `List` + `Section` for native `insetGrouped` appearance; Android falls back to React Native `SectionList`. The message list retains the existing inverted `FlatList` pattern, which is extended with `maintainVisibleContentPosition` and a rendered "↓ New messages" pill.

## Technical Context

**Language/Version**: TypeScript 5.8 / React Native 0.79 / Expo SDK 53  
**Primary Dependencies**: Expo Router 5, React Query 5, `react-native-sse`, `@expo/ui` (to be installed), `date-fns` 3  
**Storage**: React Query in-memory cache (no persistent storage; all server state)  
**Testing**: Maestro E2E flows (mobile), no unit tests per Constitution  
**Target Platform**: iOS 16+ (SwiftUI List); Android 12+ (SectionList fallback)  
**Project Type**: Mobile app feature addition  
**Performance Goals**: Message list at 60 fps; SSE reconnect ≤ 30 s max backoff; sidebar group render < 16 ms (pure client-side transform on ≤ 200 channels)  
**Constraints**: No new backend schema changes; no new protobuf RPCs; `@expo/ui` requires native rebuild (one-time); Android must not regress  
**Scale/Scope**: Single mobile app; ~4 screens touched; 4 new Maestro flows; 4 new hooks/utilities

## Constitution Check

*Gate passed. Key checks:*

| Requirement | Status | Notes |
|---|---|---|
| Maestro flows for all new mobile UI (Constitution XIII) | ✅ Required | 4 flows: channel-list, send-message, new-dm, smart-search |
| `testID` on all interactive elements (Constitution VII) | ✅ Required | All new `Pressable` / search rows must have `testID` |
| Scenario-first testing — backend integration test scope (Constitution II) | ✅ N/A for this feature | No new backend RPCs; existing integration tests cover API layer |
| No unit tests (Constitution II) | ✅ Confirmed | Only Maestro E2E flows |
| Multi-tenancy — all queries scoped to organization (Constitution I) | ✅ Already enforced | All `apis` functions pass org scoping via JWT; no change needed |
| `@expo/ui` native dependency (new) | ✅ Justified | Required for native iOS List UX; Android falls back to SectionList; documented in quickstart |

## Project Structure

### Documentation (this feature)

```text
specs/027-mobile-chat-notifications/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Technology decisions (FlatList vs FlashList, SwiftUI List, presence cache)
├── data-model.md        # Client-side view models (SidebarSection, PresenceCacheEntry, ScrollAnchor)
├── quickstart.md        # Setup steps including @expo/ui native rebuild
├── contracts/
│   └── api-contracts.md # API function inventory + new hook contracts
└── tasks.md             # Phase 2 output — NOT created by /speckit.plan
```

### Source Code

```text
frontend/apps/mobile/
├── package.json                            # Add @expo/ui
├── src/
│   ├── app/
│   │   └── (app)/
│   │       └── (chat)/
│   │           ├── index.tsx               # MODIFY: time-bucket grouping, SwiftUI List on iOS
│   │           ├── [channelId].tsx          # MODIFY: pill UI, maintainVisibleContentPosition, deep-link highlight
│   │           └── search.tsx              # NEW: smart search modal screen
│   ├── hooks/
│   │   ├── use-presence.ts                 # NEW: usePresence(employeeId) hook
│   │   └── use-app-state-presence.ts       # NEW: useAppStatePresence() hook
│   ├── providers/
│   │   └── notification-stream-provider.tsx # MODIFY: per-employee presence cache setQueryData
│   └── utils/
│       └── group-channels.ts               # NEW: groupChannelsByTime() utility
└── .maestro/
    └── chat/
        ├── channel-list.yaml               # EXPAND: time-bucket assertions, pull-to-refresh
        ├── send-message.yaml               # EXPAND: new-messages pill, scroll-to-bottom
        ├── new-dm.yaml                     # EXPAND: search → create DM flow
        └── smart-search.yaml               # NEW: search modal flow
```

**Structure Decision**: Mobile-only (Option 3 variant). No backend changes. All new files are under `frontend/apps/mobile/src/`. The `frontend/packages/apis/` package is consumed as-is (no changes needed).

## Implementation Phases

### Phase 0 — Prerequisite: Install @expo/ui

**Goal**: Get native iOS SwiftUI List capability into the app.

```sh
cd frontend/apps/mobile
npx expo install @expo/ui
npx expo run:ios  # native rebuild required
```

No code changes in this phase. Verify `@expo/ui` imports work in a test component.

---

### Phase 1 — Sidebar: Time-Grouped Layout

**Goal**: Replace flat "Direct Messages / Channels" sections with time buckets ("Today", "This Week", "Earlier"). Add presence dots on DM rows.

**Files changed**:
- `src/utils/group-channels.ts` (NEW) — `groupChannelsByTime()` pure function using `date-fns` `isToday` / `isThisWeek`.
- `src/hooks/use-presence.ts` (NEW) — `usePresence(employeeId)` React Query hook.
- `src/providers/notification-stream-provider.tsx` (MODIFY) — Change `case "presence"` to use `setQueryData(['presence', employeeId], ...)` instead of broad `invalidateQueries`.
- `src/app/(app)/(chat)/index.tsx` (MODIFY) — Replace `SectionList` with Platform-branched render: SwiftUI `List` + `Section` on iOS, `SectionList` on Android. Add `PresenceIndicator` to DM rows. Add `testID` to all interactive elements.

**Key code sketch — iOS branch**:
```tsx
import { List, Section } from '@expo/ui/swift-ui';

// iOS: native insetGrouped list
<List
  listStyle='insetGrouped'
  refreshable={{ onRefresh: refetch, isRefreshing: isRefetching }}
>
  {sections.map((section) => (
    <Section key={section.title} header={section.title}>
      <List.ForEach data={section.data} id={(ch) => ch.channel.id}>
        {(ch) => (
          <ChannelRow
            item={ch}
            hasUnread={unreadSet.has(ch.channel.id)}
            onPress={() => handleChannelPress(ch)}
          />
        )}
      </List.ForEach>
    </Section>
  ))}
</List>
```

**E2E scenario (Maestro `channel-list.yaml`)**:
- Sign in
- Assert "Today" section header visible (if channels active today)
- Assert DM row has `testID="channel-row-{channelId}"`
- Pull to refresh — assert list reloads

---

### Phase 2 — Message List: Pill + Prepend Fix

**Goal**: Render the "↓ New messages" pill; fix prepend flicker; add `testID` to pill and input.

**Files changed**:
- `src/app/(app)/(chat)/[channelId].tsx` (MODIFY):
  - Add `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` to `FlatList`
  - Render pill `Pressable` (absolute position, bottom-safe-area) when `showNewMessages` is true
  - Wire `onScroll` to update `atBottomRef` / `atBottom` state correctly
  - Add `testID="new-messages-pill"` to pill, `testID="message-input"` to `TextInput`, `testID="send-button"` to send `Pressable`

**New messages pill code sketch**:
```tsx
{showNewMessages && (
  <Pressable
    testID="new-messages-pill"
    style={styles.newMessagesPill}
    onPress={() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      setShowNewMessages(false);
    }}
  >
    <Text style={styles.pillText}>↓ New messages</Text>
  </Pressable>
)}
```

**`onScroll` update**:
```tsx
onScroll={(e) => {
  const y = e.nativeEvent.contentOffset.y;
  const isAtBottom = y < 80;
  atBottomRef.current = isAtBottom;
  if (isAtBottom !== atBottom) {
    setAtBottom(isAtBottom);
    if (isAtBottom) setShowNewMessages(false);
  }
}}
scrollEventThrottle={16}
```

**E2E scenario (Maestro `send-message.yaml`)**:
- Navigate to channel with >30 messages
- Scroll up (swipe down on inverted list in Maestro: `scroll: UP` or `swipe`)
- Assert `new-messages-pill` appears
- Tap `new-messages-pill`
- Assert pill disappears and latest message visible

---

### Phase 3 — Smart Search Modal

**Goal**: Full-screen search modal with instant local filter → debounced server search → employee DM suggestions.

**Files changed**:
- `src/app/(app)/(chat)/search.tsx` (NEW): modal screen with `TextInput` + `FlatList` results
- `src/app/(app)/(chat)/_layout.tsx` (MODIFY): add `search` route with `presentation: 'modal'`
- `src/app/(app)/(chat)/index.tsx` (MODIFY): add search icon button that routes to `/(app)/(chat)/search`

**Search logic**:
1. `query` change → filter `queryClient.getQueryData(['recentChannels'])` instantly (local, synchronous)
2. After 300ms debounce → `useQuery` with `searchChannels(query)` (server)
3. If channel results < 3 → additionally run `searchEmployees(query)` (server)
4. Employee tap → `createDirectMessage({ employeeId })` → navigate to DM channel
5. Cancel → `router.back()`

**E2E scenario (Maestro `smart-search.yaml`)**:
- Tap `testID="search-icon-button"` in chat header
- Assert search modal visible
- Type partial channel name
- Assert `testID="search-result-channel-{channelId}"` visible
- Type employee name
- Assert `testID="search-result-employee-{employeeId}"` visible
- Tap employee result
- Assert navigates to DM channel (`testID="channel-header-title"` contains employee name)

---

### Phase 4 — Presence + AppState

**Goal**: Wire `usePresence()` to DM avatar dots; send presence updates from AppState transitions.

**Files changed**:
- `src/hooks/use-app-state-presence.ts` (NEW): `useAppStatePresence()` hook
- `src/app/(app)/_layout.tsx` (MODIFY): call `useAppStatePresence()` once at root
- `src/app/(app)/(chat)/index.tsx` (MODIFY): pass `usePresence(otherPersonEmployeeId)` to `ChannelRow`; show `PresenceIndicator` on DM avatars

**Presence status mapping** (from `apis` type to `PresenceIndicator` color prop):
```ts
const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  online: '#4caf50',
  idle: '#ff9800',
  offline: '#9e9e9e',
  online_hidden: '#9e9e9e',  // treat hidden as offline for display
  unspecified: '#9e9e9e',
};
```

---

### Phase 5 — Deep-Link Highlight (P3)

**Goal**: When navigating from a notification, highlight a specific message for 3 seconds.

**Files changed**:
- `src/app/(app)/(chat)/[channelId].tsx` (MODIFY):
  - Read `highlightedMessageId` from `useLocalSearchParams()`
  - Add `highlightedMessageId` state, cleared after 3s timeout
  - `renderItem` applies `styles.messageHighlight` background when `item.id === highlightedMessageId`
  - On mount (when `highlightedMessageId` present), scroll to message index once messages load

**Limitation**: Only scrolls to highlight if message is in the first page. Older messages show the channel normally (acceptable P3 limitation per spec assumptions).

---

## Test Scenarios

### Backend Integration Test Scope

No new backend RPCs are introduced by this feature. The existing integration tests cover all consumed API endpoints (`listRecentChannels`, `searchChannels`, `searchEmployees`, `getEmployeePresence`, `updatePresenceStatus`). No new integration test files are needed.

### E2E Mobile Scenarios (Maestro)

| Flow File | Scenario | testIDs Required |
|---|---|---|
| `channel-list.yaml` | Time-grouped sidebar renders; pull-to-refresh works | `channel-row-{id}`, section headers |
| `send-message.yaml` | Send message; new-messages pill appears when scrolled up; tap pill scrolls to bottom | `new-messages-pill`, `message-input`, `send-button` |
| `new-dm.yaml` | Navigate to new-dm modal; search; create DM; open conversation | `new-dm-search-input`, `employee-result-{id}` |
| `smart-search.yaml` | Open search modal; local channel filter; employee search; tap → navigate to DM | `search-icon-button`, `search-input`, `search-result-channel-{id}`, `search-result-employee-{id}` |

### Presence SSE Payload Verification

Before implementing the `NotificationStreamProvider` change, verify the actual JSON field names in the SSE presence event:

```sh
# Backend: inspect publisher.go for presence event struct tags
grep -A 10 "presence" backend/internal/notification/publisher.go
```

Expected: `employee_id` (snake_case, Go JSON default). If different, update `notification-stream-provider.tsx` cast accordingly.

