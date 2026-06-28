# Quickstart: Mobile Chat & Notification Parity

**Feature**: `027-mobile-chat-notifications`

---

## Prerequisites

- Node.js 18+, pnpm 9+
- Xcode 15+ (for iOS build)
- An iOS Simulator or physical iOS device
- Backend stack running (Docker Compose)
- Correct branch: `git checkout 027-mobile-chat-notifications`

---

## Step 1: Install @expo/ui (Required — One-Time Native Rebuild)

`@expo/ui` is not yet in the mobile dependencies. It provides the SwiftUI `List` component used for the native iOS sidebar.

```sh
cd frontend/apps/mobile
npx expo install @expo/ui
```

This adds `@expo/ui` to `package.json`. Then trigger a clean native rebuild:

```sh
# iOS only — SwiftUI List is iOS/tvOS exclusive
npx expo run:ios
```

> **Why a rebuild?** `@expo/ui` uses native Swift modules. The JS bundle alone is not enough; the native host app must be recompiled. This is a one-time cost per developer workstation.

> **Android**: Unaffected. The Android sidebar uses the existing `SectionList`; no Android rebuild is needed for this feature.

---

## Step 2: Start the Backend

```sh
cd /path/to/tech-office
docker compose -f backend/docker-compose.yml up -d
```

Verify the backend is healthy:

```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "select 1"
```

---

## Step 3: Start Metro

```sh
cd frontend/apps/mobile
npx expo start
```

Press `i` to open in iOS Simulator (after Step 1 has been completed at least once).

---

## Step 4: Verify Core Features Work

### Real-time messages
1. Log in with two test accounts on two devices/simulators.
2. Open a shared DM from Account A.
3. Send a message from Account B (web or another device).
4. Verify the message appears in Account A's conversation without manual refresh.

### New messages pill
1. In a conversation with history, scroll up (past the first page).
2. Send a message from another account.
3. Verify "↓ New messages" pill appears at the bottom.
4. Tap the pill — verify smooth scroll to the latest message and pill disappears.

### Sidebar time grouping
1. Open the Chat tab.
2. Verify conversations are grouped under "Today", "This Week", "Earlier" headers.
3. On iOS, verify the List uses native `insetGrouped` style (rounded cards, inset rows).

### Smart search
1. Tap the search icon in the Chat tab header.
2. Type a partial channel name — verify instant local results appear.
3. Type an employee name — verify employee suggestions appear after ~300ms.
4. Tap an employee — verify a DM channel opens.

### Presence dots
1. Open the DM conversation list.
2. Verify colored dots appear on DM avatars (green = online, amber = idle, grey = offline).
3. Change presence in another session and verify the dot updates within a few seconds.

---

## Step 5: Run Maestro Flows (CI Verification)

```sh
cd frontend/apps/mobile

# Requires Maestro CLI installed: brew install mobile-dev-inc/tap/maestro
maestro test .maestro/chat/channel-list.yaml
maestro test .maestro/chat/send-message.yaml
maestro test .maestro/chat/new-dm.yaml
maestro test .maestro/chat/smart-search.yaml
```

> **Note**: The Maestro flows are updated as part of this feature. Confirm all 4 flows pass before submitting for review.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `@expo/ui` import error at runtime | Native rebuild not done | Run `npx expo run:ios` again |
| SwiftUI List not rendering (white screen) | `@expo/ui` version mismatch | Check `expo doctor` output; align version |
| Presence dots not updating | SSE `presence` event payload field name mismatch | Inspect raw SSE stream; adjust `NotificationStreamProvider` field mapping |
| Time buckets not grouping correctly | Timezone issue in `isToday` / `isThisWeek` | Verify `date-fns` locale; ensure device timezone matches expected bucket |
| `maintainVisibleContentPosition` causes Android crash | React Native version incompatibility | Apply only on `Platform.OS === 'ios'` as fallback |
| Maestro flows fail immediately | App not running in background before test | Start Expo (`npx expo start`) first; confirm simulator is booted |
