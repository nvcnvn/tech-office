# Data Model: Mobile Chat & Notification Parity

**Feature**: `027-mobile-chat-notifications`

All data here lives in the **mobile app only** (React Query cache + component state). No new backend tables or columns are required for this feature.

---

## 1. Sidebar Section Model (Client-Side View Data)

Used by the time-grouped sidebar in `/(app)/(chat)/index.tsx`.

```ts
// Produced by groupChannelsByTime() utility
interface SidebarSection {
  title: 'Today' | 'This Week' | 'Earlier';
  data: ChannelWithDetails[];  // sorted by lastMessageAt desc within bucket
}
```

**Grouping rules** (applied in local timezone):
- `"Today"` — `lastMessageAt` is on the current calendar date.
- `"This Week"` — `lastMessageAt` is within the current ISO week but not today.
- `"Earlier"` — any earlier timestamp.
- Channels with no `lastMessageAt` sort to the end of "Earlier".
- Empty sections are omitted from the output array.

**Source**: `ChannelWithDetails[]` from `listRecentChannels()` API (already ordered by recency).

---

## 2. Presence Cache Entry (React Query Cache)

Stored in React Query under key `['presence', employeeId]`.

```ts
// Shape returned by getEmployeePresence() and set by SSE events
type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

interface PresenceCacheEntry {
  employeeId: string;
  status: PresenceStatus;
  updatedAt: string;  // ISO-8601, used for stale detection
}
```

**Lifecycle**:
- Initial load: queried on first render of a DM row or channel header via `usePresence(employeeId)`.
- Live update: `NotificationStreamProvider` SSE handler calls `queryClient.setQueryData(['presence', employeeId], entry)` on each `presence` event.
- Stale time: 60 seconds (presence changes are immediately overridden by SSE, so stale time only affects offline scenarios).

---

## 3. Scroll Anchor State (Component State in MessageScreen)

Local state in `[channelId].tsx`. Not persisted across unmounts.

```ts
// Refs (stable across renders, used inside callbacks)
const atBottomRef = useRef<boolean>(true);
const lastMessageIdRef = useRef<string | null>(null);

// State (drives pill UI render)
const [atBottom, setAtBottom] = useState<boolean>(true);
const [showNewMessages, setShowNewMessages] = useState<boolean>(false);
```

**Transitions**:
- On screen mount / channel change → both `atBottom` and `atBottomRef` reset to `true`; `showNewMessages` = `false`; `lastMessageIdRef` = `null`.
- `onScroll` event: `atBottom = contentOffset.y < 80` (inverted FlatList; y=0 is bottom).
- SSE new message detected: if `!atBottomRef.current`, set `showNewMessages = true`.
- Pill tapped: `scrollToOffset({ offset: 0 })`, then `setShowNewMessages(false)`.
- User scrolls to bottom: `setShowNewMessages(false)`.

---

## 4. Highlighted Message State (Component State in MessageScreen)

Local state in `[channelId].tsx`. Used for deep-link navigation from notifications.

```ts
const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
```

**Lifecycle**:
- Set from `useLocalSearchParams().highlightedMessageId` on screen mount.
- Cleared by `setTimeout(..., 3000)` after the FlatList scroll completes.
- Used by `renderItem` to apply a distinct background to the matching message bubble.
- Cleared on channel change (via `useEffect` on `channelId`).

---

## 5. Search State (Component State in SearchModal)

Local state in `/(app)/(chat)/search.tsx`.

```ts
const [query, setQuery] = useState<string>('');

// Derived sections for FlatList of results
interface SearchSection {
  title: 'Channels' | 'People';
  data: (ChannelWithDetails | EmployeeSearchResult)[];
}
```

**Lifecycle**:
- On `query` change: immediately filter `queryClient.getQueryData(['recentChannels'])` for local channel matches.
- After 300ms debounce: call `searchChannels(query)` API.
- If channel results < 3: additionally call `searchEmployees(query)` API.
- Dismiss: `router.back()` clears all state (full component unmount).

---

## 6. Presence Send State (App-Wide, AppState Listener)

Managed in a new `useAppStatePresence()` hook, used once at the root layout level.

```ts
// Internal to hook — not exposed
const lastSentStatus = useRef<PresenceStatus>('online');
```

**Lifecycle**:
- On mount: `AppState.addEventListener('change', handler)`.
- `nextState === 'active'` → call `updatePresenceStatus({ status: 'online' })` if not already `'online'`.
- `nextState === 'background' | 'inactive'` → call `updatePresenceStatus({ status: 'away' })`.
- On unmount: remove listener.

---

## 7. No New Backend Data Models

All existing API response types (`ChannelWithDetails`, `ChatMessage`, `PresenceStatus`) are used as-is. The mobile app adds only client-side view models on top of server-returned data. No schema migrations or new protobuf messages are required for this feature.
