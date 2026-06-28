# API Contracts: Mobile Chat & Notification Parity

**Feature**: `027-mobile-chat-notifications`

These contracts describe the API functions consumed by mobile screens in this feature. All functions are in the `apis` workspace package (`frontend/packages/apis/src/`). No new backend endpoints are required; only new mobile hooks and one change to `NotificationStreamProvider` are needed.

---

## Existing API Functions — Confirmed Available

These already exist and are ready to use without changes:

### `chat.ts`

```ts
// List channels sorted by last activity — used for sidebar
listRecentChannels(): Promise<ChannelWithDetails[]>

// Full-text search across channels
searchChannels(queryText: string, limit?: number, cursor?: string): Promise<ChannelSearchResult[]>

// List messages for a channel with cursor-based pagination
listMessages(params: ListMessagesParams): Promise<ListMessagesResponse>

// Send a message
sendMessage(params: SendMessageParams): Promise<void>

// Mark channel as read
markChannelAsRead(params: { channelId: string }): Promise<void>

// Get channel info
getChannel(channelId: string): Promise<GetChannelResponse>

// Create or get a DM channel between two employees
createDirectMessage(params: { employeeId: string }): Promise<GetChannelResponse>

// Reactions
addReaction(params: { messageId: string; emojiCode: string }): Promise<void>
removeReaction(params: { messageId: string; emojiCode: string }): Promise<void>

// Typing indicators
startTyping(channelId: string): Promise<void>
stopTyping(channelId: string): Promise<void>
```

### `organization.ts`

```ts
// Search employees by name — used for DM search suggestions
searchEmployees(queryText: string, limit?: number, cursor?: string): Promise<EmployeeSearchResult[]>
```

### `presence.ts`

```ts
// PresenceStatus type (canonical, must align with backend)
type PresenceStatus = 'online' | 'online_hidden' | 'idle' | 'offline' | 'unspecified';

// Get presence for a single employee (respects visibility settings)
getEmployeePresence(employeeId: string): Promise<EmployeePresence | null>

// Get presence for multiple employees in one round trip
getBatchEmployeePresence(employeeIds: string[]): Promise<Map<string, EmployeePresence>>

// Update the current user's own presence status
updatePresenceStatus(params: UpdatePresenceParams): Promise<UpdatePresenceResult>
```

---

## Required Mobile Hook Contracts (New)

These are implemented in `frontend/apps/mobile/src/hooks/` as part of this feature.

### `usePresence(employeeId: string): PresenceStatus | null`

```ts
// File: frontend/apps/mobile/src/hooks/use-presence.ts
//
// Reads presence from React Query cache; fetches from API on first call.
// Cache key: ['presence', employeeId]
// Stale time: 60 seconds
// Live updates: set by NotificationStreamProvider on SSE 'presence' events.

import { useQuery } from '@tanstack/react-query';
import { getEmployeePresence, type PresenceStatus } from 'apis';

export function usePresence(employeeId: string | undefined): PresenceStatus | null {
  const { data } = useQuery({
    queryKey: ['presence', employeeId],
    queryFn: () => getEmployeePresence(employeeId!),
    enabled: !!employeeId,
    staleTime: 60_000,
    select: (presence) => presence?.status ?? null,
  });
  return data ?? null;
}
```

### `useAppStatePresence(): void`

```ts
// File: frontend/apps/mobile/src/hooks/use-app-state-presence.ts
//
// Listens to React Native AppState changes and pushes presence status updates.
// Used once at the root layout level — NOT per-screen.
// Does NOT manage SSE connection (that's NotificationStreamProvider's job).

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { updatePresenceStatus } from 'apis';

export function useAppStatePresence(): void {
  const lastSentRef = useRef<'online' | 'away'>('online');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const target = nextState === 'active' ? 'online' : 'away';
      if (lastSentRef.current === target) return;
      lastSentRef.current = target;
      updatePresenceStatus({
        status: target,
        activeChannelId: null,
        lastInteractionAt: new Date(),
      }).catch(() => {});
    });
    return () => sub.remove();
  }, []);
}
```

---

## NotificationStreamProvider Change Contract

**File**: `frontend/apps/mobile/src/providers/notification-stream-provider.tsx`

**Current** (in `invalidateForEvent`):
```ts
case "presence": {
  queryClient.invalidateQueries({ queryKey: ["presence"] });
  break;
}
```

**Required change**: Parse employee ID from SSE payload and use `setQueryData` for targeted per-employee cache update. Broad invalidation leaks unrelated presence queries.

```ts
case "presence": {
  // Payload shape: { employee_id: string, status: PresenceStatus, updated_at: string }
  const employeeId = payload.employee_id as string | undefined;
  if (employeeId) {
    // Optimistic set — avoids a refetch for simple status changes
    queryClient.setQueryData(
      ['presence', employeeId],
      {
        employeeId,
        status: payload.status as string,
        lastInteractionAt: new Date(),
        lastHeartbeat: new Date(),
      }
    );
  } else {
    // Fallback: broad invalidation if employee_id not in payload
    queryClient.invalidateQueries({ queryKey: ['presence'] });
  }
  break;
}
```

> **Note**: The SSE `presence` event payload field name (`employee_id` vs `employeeId`) must be verified against what the backend actually emits. Check `backend/internal/notification/publisher.go` for the exact JSON field names. If the field name differs, update the cast in `NotificationStreamProvider` accordingly.

---

## Sidebar Grouping Utility Contract

**File**: `frontend/apps/mobile/src/utils/group-channels.ts`

```ts
import { startOfDay, startOfWeek, isToday, isThisWeek } from 'date-fns';
import type { ChannelWithDetails } from 'apis';

export interface SidebarSection {
  title: 'Today' | 'This Week' | 'Earlier';
  data: ChannelWithDetails[];
}

// Groups a pre-sorted ChannelWithDetails[] into time-bucket SidebarSections.
// Empty sections are omitted.
export function groupChannelsByTime(channels: ChannelWithDetails[]): SidebarSection[] {
  const today: ChannelWithDetails[] = [];
  const thisWeek: ChannelWithDetails[] = [];
  const earlier: ChannelWithDetails[] = [];

  for (const ch of channels) {
    const lastActivity = ch.channel.lastMessageAt
      ? new Date(ch.channel.lastMessageAt)
      : null;

    if (!lastActivity) {
      earlier.push(ch);
    } else if (isToday(lastActivity)) {
      today.push(ch);
    } else if (isThisWeek(lastActivity, { weekStartsOn: 1 })) {
      thisWeek.push(ch);
    } else {
      earlier.push(ch);
    }
  }

  const sections: SidebarSection[] = [];
  if (today.length > 0) sections.push({ title: 'Today', data: today });
  if (thisWeek.length > 0) sections.push({ title: 'This Week', data: thisWeek });
  if (earlier.length > 0) sections.push({ title: 'Earlier', data: earlier });
  return sections;
}
```

> `date-fns` is already installed in the mobile app (`"date-fns": "^3.0.0"`).

---

## Known Payload Risk

The SSE `presence` event payload field names are assumed to be `employee_id` and `status` (snake_case, matching Go JSON serialization convention used throughout the backend). This must be verified before implementing `NotificationStreamProvider`'s `presence` case change. If the backend uses camelCase, update cast accordingly.

**Verification command**:
```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c \
  "select * from notification.active_connection limit 5"
```
Also check `backend/internal/notification/publisher.go` for the JSON struct tags on the presence event payload.
