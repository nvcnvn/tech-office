---

description: "Task list for feature 051 — Notification Preference Completeness"
---

# Tasks: Notification Preference Completeness

**Input**: Design documents from `/specs/051-notification-preference-completeness/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution principle II makes
[contracts/test-scenarios.md](./contracts/test-scenarios.md) the feature's
behavioural contract, and the spec requires scenario coverage for every
user-observable FR. Test tasks are written from that file verbatim — the
scenario names are the contract, not a suggestion.

**Organization**: Tasks are grouped by user story so each can be implemented and
tested independently. The write path (Phase 2) is genuinely shared: the stored
record has never had one, so no story can be demonstrated until it exists.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task names the exact file it touches

## Path Conventions

Mobile + API monorepo: Go backend under `backend/`, pnpm workspace under
`frontend/` (`packages/apis`, `apps/mobile`), living behaviour snapshots under
`docs/domain/`. Paths below are repository-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring the local stack to the state the feature is built against. No
project initialization is needed — every package, service and screen this
feature touches already exists.

- [X] T001 Start infrastructure and bring the database to head with the repository's own tooling: `make infra-up`, then `cd backend && ./scripts/migrate.sh` with `DATABASE_URL` set, per [quickstart.md](./quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Give `notification.personal_preference` a read/write surface. Today
the table has exactly one query against it (a `SELECT`) and no RPC at all, so
**no user story is demonstrable until this phase completes** — US1 needs the
write path to persist in-app alerts, US2 needs it to persist a mute, US3 has
nothing to describe without both.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Schema

- [X] T002 Create the forward-only migration `backend/database/migrations/20260905000002_notification_preference_completeness.up.sql`: `ALTER TABLE notification.personal_preference ADD COLUMN in_app_alerts_enabled boolean NOT NULL DEFAULT true`, and drop and recreate `muted_domains_valid` as `CHECK (muted_domains <@ ARRAY['chat','projects','docs','crm','hr','support','finance','system','calendar'])` per [data-model.md](./data-model.md). Widening a contained-by CHECK only admits previously-refused values, so no data migration and no `.down.sql` (the repository is forward-only)
- [X] T003 Apply the migration with `cd backend && ./scripts/migrate.sh` and regenerate the snapshot with `cd backend && ./scripts/regen-schema.sh` — `backend/database/scripts/schema.sql` is generated and MUST NOT be hand-edited

### Backend contract

- [X] T004 [P] In `backend/internal/notification/constants.go`, make the nine source domains single-sourced: keep `AllSourceDomains` as the one list and redefine `IsValidSourceDomain` over it (today the function repeats the list in a `switch`, which is one of the three copies that let D28 happen). Add the comment naming the four locations that must agree — the Go list, the two source-domain CHECKs, and `SourceDomain` in `packages/apis`
- [X] T005 Add `-- name: UpsertPersonalPreference :one` to `backend/database/scripts/notification.query.sql`, beside the existing `GetPersonalPreference`: `INSERT … ON CONFLICT (organization_id, employee_id) DO UPDATE SET` all five preference columns plus `updated_at = now()`, `RETURNING *`. `organization_id` is a named parameter pinned from the auth context; no `-- lint:cross-tenant` marker
- [X] T006 Run `cd backend && sqlc generate` to regenerate `backend/database/models.go` (new column) and `backend/database/notification.query.sql.go` (new query)
- [X] T007 [P] Append the two rpcs and four messages to `backend/rpc/v1/notification.proto` exactly as specified in [contracts/notification-preferences.proto](./contracts/notification-preferences.proto): `GetNotificationPreferences` guarded by `pref.view`, `UpdateNotificationPreferences` guarded by `pref.update`, placed beside the existing `GetPresenceSettings`/`SetPresenceVisibility` pair whose shape they follow
- [X] T008 Run `cd backend && buf generate` to regenerate `backend/rpc/v1/notification.pb.go` and the `frontend/packages/rpc` client stubs

### Backend logic and handlers

- [X] T009 Create `backend/internal/notification/preference_logic.go` — pool-agnostic, taking `tx database.DBTX`, mirroring `visibility_logic.go`. Four pieces: `filterKnownDomains` (drops stored domains the system no longer recognises, preserving order — [research.md R8](./research.md)); `normalizeMutedDomains` (rejects the first unrecognised value **by name**, then deduplicates and sorts — FR-007, FR-008); do-not-disturb `HH:MM` validation with `00<=HH<=23` and `00<=MM<=59`; and get-with-defaults / whole-record upsert over the two queries. Validation runs in the data-model's stated order, before any write, so a refused request stores nothing
- [X] T010 Create `backend/internal/notification/preference_connect.go` — the two handlers, mirroring `visibility_connect.go`: `extractAuthContext` for organization and employee (never from the request — FR-005), `txn.WithTxn` ownership, domain errors translated to `connect.Error` with `CodeInvalidArgument` naming the rejected value. `GetNotificationPreferences` returns the documented defaults with `exists = false` when no row is stored (FR-006), and filters `muted_domains` through `filterKnownDomains` on the way out
- [X] T011 Wire `PreferenceLogic` into the service constructor in `backend/internal/notification/connect.go`, following how `VisibilityLogic` is wired
- [X] T012 Verify the backend gates: `cd backend && go build ./... && go vet ./...` and `make lint-tenancy` — `UpsertPersonalPreference` writes a tenant table, so the tenancy linter must pass without a cross-tenant exemption

### Frontend contract

- [X] T013 [P] In `frontend/packages/apis/src/notification.ts`, add `'calendar'` to the `SourceDomain` union (a second, unregistered instance of D28 on the client side) and export `SOURCE_DOMAINS` in the mute-list display order from [contracts/apis-wrapper.md](./contracts/apis-wrapper.md): `chat, projects, calendar, docs, crm, hr, support, finance, system`. Extend the existing "MUST align with…" comment block with `notification.personal_preference.muted_domains` as a fourth location
- [X] T014 Create `frontend/packages/apis/src/notification-preferences.ts` — the `NotificationPreferences` interface, `getNotificationPreferences()` and `updateNotificationPreferences(next: Omit<NotificationPreferences, 'updatedAt' | 'exists'>)`, both through `rpcCall` and `notificationClient` like every other wrapper in the package. The `Omit` is FR-009 enforced by the type system: no caller can express a partial update
- [X] T015 Re-export the new module from `frontend/packages/apis/src/index.ts`

### Test infrastructure

- [X] T016 Add `publishDomainNotification(recipientID, sourceDomain, notificationType, policyKey, priority, title)` and the two preference-RPC helpers to `backend/integration/helper_test.go`. The three existing publish helpers hard-code `chat`/`message`, and this feature is about the domains that are not chat

**Checkpoint**: The stored preference can be read and written by its owner, and
`calendar` is a legal value everywhere. User story work can begin.

---

## Phase 3: User Story 1 - The in-app alert choice follows the person (Priority: P1) 🎯 MVP

**Goal**: The In-App Alerts switch stops living on the handset and starts living
on the person. Turning it off on one device turns it off on their next device;
a colleague signing in to the same handset gets their own value; nothing else
about the notification — the list, the unread count, the push — changes.

**Independent Test**: Turn In-App Alerts off on one signed-in device, sign in as
the same person on a second device, and confirm it reads off without being
touched. Sign in as a different person on the same device and confirm it reads
on.

### Tests for User Story 1 ⚠️

> Write these as `t.Run` stubs first and confirm they fail before implementing.

- [X] T017 [P] [US1] Create `backend/integration/notification_personal_preference_test.go` with `TestNotificationPersonalPreference` in the `testWorld` idiom, and the five record-contract scenarios from [contracts/test-scenarios.md](./contracts/test-scenarios.md): "a person who has never set preferences reads the documented defaults" (FR-006, FR-011 — alerts on, nothing muted, DND off, `exists = false`); "the first change creates the record and reads back exactly" (FR-004, FR-010, FR-013); "a person reads and writes only their own preferences" (FR-005 — alice mutes chat, bob's read is untouched and still `exists = false`); "a change replaces the whole record" (FR-009 — a DND window survives a mute-list change, then is cleared not merged when sent false); "turning in-app alerts off changes nothing the server does" (FR-012 — still recorded, still listed, still counted, still pushed)

### Implementation for User Story 1

- [X] T018 [US1] Create `frontend/apps/mobile/src/hooks/use-notification-preferences.ts` per [contracts/apis-wrapper.md §3](./contracts/apis-wrapper.md): React Query over key `["notification-preferences"]`, returning `preferences` (never null — defaults until the first read), `loading`, `saving`, `isMuted`, `setInAppAlerts`, `setDomainMuted`. `onMutate` cancels, snapshots and applies optimistically; `onError` restores the snapshot and surfaces the failure; `onSettled` invalidates so the server's deduped, sorted record wins. Both setters read the cached record and send all five fields. No provider, no context, no offline queue — this is the theme toggle's pattern (`src/lib/theme.tsx`), which the spec names as precedent
- [X] T019 [US1] Confirm the query key is covered by `setupQueryPersistence` and cleared by `resetAuthenticatedAppState` on sign-out in the mobile query-client setup — that clearing is what makes US1 scenario 2 (a colleague on the same handset sees their own value) true with no extra code
- [X] T020 [US1] Rewire the In-App Alerts row in `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx` to `useNotificationPreferences`: delete the `notificationsEnabled` `React.useState`/MMKV read and the `handleNotificationsToggle` handler, drive the `Switch` from `preferences.inAppAlertsEnabled` via `setInAppAlerts`, and add `testID="setting-in-app-alerts-switch"` to the switch itself (the flow has to tap the switch; `SettingRow`'s press target toggles too)
- [X] T021 [US1] Point the foreground banner gate in `frontend/apps/mobile/src/app/(app)/_layout.tsx` at the hook instead of `useInAppAlertsEnabled` (line ~37 import, ~104 read, ~345 render condition). While preferences are loading the gate reads `true`: one banner drawn before the preference arrives is a smaller failure than a silenced app, and the value comes from the persisted cache on every launch after the first
- [X] T022 [US1] Delete `frontend/apps/mobile/src/lib/app-settings.ts` in full (FR-014) — the file holds nothing but the old MMKV key, so emptying it would be the shim FR-014 forbids. Confirm `grep -r notifications_enabled frontend/` returns nothing (SC-007)
- [X] T023 [US1] Run `cd frontend && pnpm run typecheck:mobile && pnpm lint` — with `app-settings.ts` gone, any surviving importer is a compile error rather than a runtime surprise, which is what proves FR-014. (Standing caveat D34: nothing runs `tsc` on mobile in CI, so this must be run by hand)

**Checkpoint**: In-App Alerts persists to the account, follows the person across
devices and reinstalls, and still leaves the list, the unread count and push
alone. Independently demonstrable.

---

## Phase 4: User Story 2 - Mute a noisy domain, calendar included (Priority: P2)

**Goal**: A person can mute any of the nine source domains — Calendar among
them, which is drift D28 — from the settings screen, and the phone stops buzzing
for that domain while the notification still lands in their list and other
domains still push.

**Independent Test**: Mute a domain from the settings screen, publish a
notification in that domain to the muted person while they are offline, and
confirm no push is delivered while an unmuted domain's notification to the same
person still is.

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Create `backend/internal/notification/preference_logic_test.go` with two table-driven cases beside the package's existing `publisher_test.go`: `filterKnownDomains` drops a stored domain the system no longer recognises and preserves the rest in order (the edge case no integration test can reach, because the CHECK makes such a row unwritable through any supported path), and `normalizeMutedDomains` deduplicates, sorts, and reports the first unrecognised value by name (FR-007, FR-008)
- [X] T025 [P] [US2] Add the validation and completeness scenarios to `backend/integration/notification_personal_preference_test.go`: "a domain the system does not recognise is refused by name and stores nothing" (FR-007 — `InvalidArgument` mentioning `marketing`, prior mute list byte-identical afterwards); "a domain named twice is stored once" (FR-008); "a malformed do-not-disturb time is refused" (`25:00` → `InvalidArgument`); "calendar can be muted" (FR-001, stated on its own so a regression is legible); "every source domain the system publishes from can be muted" (FR-002, SC-002 — iterate `notification.AllSourceDomains`, mute each in turn, assert each is accepted). The last is the guard that stops the CHECK, the Go list and the TypeScript list drifting again
- [X] T026 [P] [US2] Add the delivery scenarios to `backend/integration/notification_personal_preference_test.go` using `publishDomainNotification`: "muting calendar suppresses push for a calendar notification" (FR-015 — recipient offline with a registered push token, `delivery_attempt` reason `suppressed_by_preference`); "a muted domain's notification is still listed and still counts as unread" (FR-016, SC-006); "muting one domain leaves another domain's push alone" (FR-018); "with every domain muted a mention still pushes" (FR-017, SC-005 — priority-0 is not suppressed); "unmuting restores push with no further action" (US2 scenario 6)

### Implementation for User Story 2

- [X] T027 [P] [US2] Add `creditcard.fill` → Ionicons `card` to the glyph map in `frontend/apps/mobile/src/components/ui/sf-icon.tsx`. Eight of the nine mute-row icons are already mapped; `SFIcon` renders an unmapped name as a missing icon rather than a crash, which is why this has to be added deliberately
- [X] T028 [US2] Add the "Mute by area" `Card` to the Notifications section of `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`: one `SettingRow` per entry of `SOURCE_DOMAINS`, in that order, with the exact labels and icons from [contracts/settings-copy.md §2](./contracts/settings-copy.md) (`Chat`, `Tasks and projects`, `Calendar`, `Documents`, `Customers`, `People and HR`, `Support`, `Finance`, `System`), `testID="setting-mute-<domain>"` on the row and `setting-mute-<domain>-switch` on the switch, switch on = muted, driven by `isMuted`/`setDomainMuted`. The domain→label→icon map lives beside the screen, not in `apis` — it is UI copy, while the domain list itself is a cross-stack constant
- [X] T029 [US2] Implement the three control states from [contracts/settings-copy.md §3](./contracts/settings-copy.md) in the same screen: while preferences are loading every switch renders at its default and is **disabled** (FR-022 — nobody acts on a value the server has not confirmed); while a write is in flight the touched switch has already moved and every switch in the section is disabled so a second tap cannot race the first (FR-021); on failure the cache rolls back and the switch returns to its stored position
- [X] T030 [US2] Create `frontend/apps/mobile/.maestro/settings/notification-preferences.yaml` following the shape of `.maestro/settings/dark-mode-toggle.yaml`: sign in → More → Settings → assert the mute list is visible with Calendar in it → toggle In-App Alerts off → toggle Mute Calendar on → **relaunch the dev client** → More → Settings → assert In-App Alerts is off and Calendar is muted. The relaunch rather than a reinstall is the point: it proves the values were read back, not remembered. (Covers FR-019, FR-021, FR-022, SC-002, SC-004 across US1 and US2, so it lands here where both halves of the screen exist)
- [X] T031 [US2] Confirm the delivery pipeline is unchanged by running the three named pre-existing suites: `make test-backend-one T=TestNotificationDeliveryConsistency`, `T=TestNotificationPreferences`, `T=TestCalendarNotification`. `ShouldSuppressPush` is not touched by this feature; if any of these move, something was changed that should not have been

**Checkpoint**: Any of the nine domains, Calendar included, can be muted from
the app; push stops for it and nothing else changes. US1 and US2 both work
independently.

---

## Phase 5: User Story 3 - The settings screen says what it actually does (Priority: P3)

**Goal**: Each control states in plain language which noise it removes and which
it leaves alone, so nobody looks for a switch that does not exist or believes
they have silenced something they have not.

**Independent Test**: Read the settings screen cold and confirm each control's
description matches what the US1 and US2 acceptance scenarios assert, including
the exceptions.

**Note**: The strings are the contract. An implementer who paraphrases them can
reintroduce exactly the overpromise this feature exists to remove — the current
subtitle states only the first half of what the switch does, which is why it
reads as "turn notifications down".

### Implementation for User Story 3

- [X] T032 [US3] Replace the In-App Alerts subtitle in `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx` with the verbatim string from [contracts/settings-copy.md §1](./contracts/settings-copy.md): `Show banners while you're using the app. Your alerts list, unread badges and phone notifications are not affected.` (FR-020, US3 scenario 1)
- [X] T033 [US3] Add the mute-list intro line above the mute `Card` in the same file, `testID="setting-mute-intro"`, verbatim: `Muting an area stops the phone notification for it. The alert still arrives in your list. Mentions and incoming calls always come through.` — both remaining FR-020 obligations, stated once rather than repeated on nine rows (US3 scenarios 2 and 3)
- [X] T034 [US3] Use the failure `Alert` copy from [contracts/settings-copy.md §3](./contracts/settings-copy.md) in `use-notification-preferences.ts`'s `onError`: title `Couldn't save that`, body `We couldn't save that just now, so it has been put back. Check your connection and try again.` — the wording the theme toggle already uses for the same situation (FR-021)

**Checkpoint**: All three user stories are independently functional and the
screen no longer promises more than it delivers.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Constitution principle XII obligations and the end-to-end proof.
SC-008 makes the documentation updates part of this feature, not a follow-up.

- [X] T035 [P] Update `docs/domain/notifications-presence.md`: **remove** the "`muted_domains` omits `calendar`" drift paragraph, add `in_app_alerts_enabled` to the `personal_preference` row of the storage table, and describe the two new RPCs and their `pref.view`/`pref.update` guards
- [X] T036 [P] Update `docs/domain/calendar.md`: **remove** the "Calendar cannot be domain-muted" drift paragraph
- [X] T037 [P] Check `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` for statements that the personal preference has no write path or no client, and correct them — the record now has both
- [X] T038 Remove **D28** from the drift register in `docs/domain/README.md` (SC-008). Do this after T035–T037 so the register and the snapshots it points at move together
- [X] T039 Run the mobile flow on **both** an Android device and an iOS target: `cd frontend/apps/mobile && maestro test .maestro/settings/notification-preferences.yaml`. Android is not optional here — the habitual test device is an iPhone SE, and a nine-row settings section is exactly the shape that overflows unnoticed on a narrow Android screen
- [X] T040 Walk the two manual checks from [quickstart.md §5](./quickstart.md) that no driver can show: the preference following the person across two signed-in devices and resetting for a colleague on the same handset (US1, SC-003), and a refused write being visible — airplane mode, flip a mute, watch it move and return with the explanation, then restore the network and confirm nothing was queued (FR-021)
- [X] T041 Time SC-001 from a cold open: More → Settings → Notifications → Calendar muted in under 30 seconds, then confirm a calendar invite sent to the locked phone produces no push while still waiting in the alerts tab. **Measured**: the More → Settings → Calendar-muted path took 15s wall-clock on the Android emulator including maestro's own JVM startup, so the in-app path is roughly 10–12s — inside the 30s budget with room to spare. The cold open itself measured 34s, but that is the Expo dev client re-downloading and re-executing the JS bundle, which does not exist in a release build; it is excluded from the SC-001 figure. [ASSUMPTION: the push half was verified through the backend rather than by watching a physical handset. The only targets available were an Android emulator and an iOS simulator, neither of which receives a real FCM delivery, so a "the phone did not buzz" observation on them would prove nothing. The two integration scenarios that already cover it drive the real publisher and routing pipeline: "muting calendar suppresses push for a calendar notification" asserts the `delivery_attempt` row with reason `suppressed_by_preference`, and "a muted domain's notification is still listed and still counts as unread" asserts the other half of the same sentence. Both pass.]
- [X] T042 Walk the Definition of Done checklist in [quickstart.md](./quickstart.md) and confirm every box, including that `schema.sql` was regenerated rather than edited. Every box is ticked except `pnpm lint` clean. `schema.sql` was confirmed generated rather than hand-edited by re-running `./scripts/regen-schema.sh` and diffing against the committed file — byte-identical. [ASSUMPTION: the `pnpm lint` box is left unticked and recorded as drift **D67** rather than treated as a blocker. It fails at HEAD with 177 errors across 78 files in all three workspaces, and stashing the entire working tree and re-running reproduces the identical failure, so it is pre-existing and not this feature's. Fixing 78 unrelated files would be a far larger and riskier change than the feature itself and would bury it. The substitute check actually run was `npx eslint` over all seven files 051 touches, which exits 0.]

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **blocks all three user stories**, because the stored record has no write path of any kind until it completes
- **User Story 1 (Phase 3)**: Depends on Phase 2 only
- **User Story 2 (Phase 4)**: Depends on Phase 2. Its backend half is independent of US1; its UI half lands in the same screen section US1 rewires, so run T028 after T020 to avoid editing the same block twice
- **User Story 3 (Phase 5)**: Depends on US1 and US2 — it describes controls that must already behave correctly, which is precisely why the spec ranks it last
- **Polish (Phase 6)**: Depends on all three stories

### Within Phase 2 (ordering that matters)

- T002 → T003 (apply before regenerating the snapshot)
- T003 → T005 → T006 (the column must exist before the query is generated over it)
- T007 → T008 (proto before codegen)
- T004, T006, T008 → T009 → T010 → T011 → T012
- T008 → T014 (the wrapper needs the generated client stubs)
- T013 is independent of the backend chain and can run at any point

### Within Each User Story

- Tests are written first and must fail before implementation
- Backend scenarios (T017, T024–T026) are independent of the mobile work in the same phase and can run alongside it
- Copy (Phase 5) lands after the controls it describes

### Parallel Opportunities

- **Phase 2**: T004, T007 and T013 touch three different files with no shared dependency and can run together at the start of the phase. T016 can be written in parallel with the whole backend chain
- **Phase 3**: T017 (backend scenarios) runs in parallel with T018–T023 (mobile) — different stacks, different files
- **Phase 4**: T024, T025, T026 and T027 are four different files and can all run together. The three test tasks are independent of the two UI tasks
- **Phase 6**: T035, T036 and T037 are three different documents. T038 waits for them
- **Across stories**: once Phase 2 lands, one developer can take the US2 backend scenarios while another takes the US1 mobile rewire

---

## Parallel Example: Phase 2 kickoff

```bash
# Three independent files, no shared dependency:
Task: "Single-source AllSourceDomains in backend/internal/notification/constants.go"
Task: "Append the two rpcs and four messages to backend/rpc/v1/notification.proto"
Task: "Add 'calendar' and SOURCE_DOMAINS to frontend/packages/apis/src/notification.ts"
```

## Parallel Example: User Story 2 tests

```bash
Task: "preference_logic_test.go — filterKnownDomains and normalizeMutedDomains"
Task: "Validation and completeness scenarios in notification_personal_preference_test.go"
Task: "Delivery scenarios in notification_personal_preference_test.go"
Task: "creditcard.fill glyph in components/ui/sf-icon.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup
2. Phase 2: Foundational — **critical, blocks everything**
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: two devices, one person, one setting that follows them
5. At this point the stored record has a write path and the handset holds no
   authoritative notification value. That alone is shippable

### Incremental Delivery

1. Setup + Foundational → the record can be read and written
2. US1 → In-App Alerts follows the person → demo
3. US2 → any domain, Calendar included, can be muted → demo, and D28 is fixed in code
4. US3 → the screen stops overpromising → demo
5. Polish → the snapshots and the drift register catch up with the code

### Parallel Team Strategy

Phase 2 is not divisible below its three parallel starts (T004, T007, T013);
after that the backend chain is one person's work. Once it lands:

- Developer A: US1 mobile (T018–T023) then US3 copy
- Developer B: US2 backend scenarios (T024–T026)
- Developer C: US2 UI (T027–T030) after A finishes T020

---

## Notes

- The suppression machinery is **not touched**. `ShouldSuppressPush` already
  mutes push only, already leaves the row, the SSE event and the unread count
  alone, and already exempts priority-0 mentions and calls
  (`routing_logic.go:233`). FR-015…FR-018 describe behaviour that already
  exists but that nobody could reach
- `in_app_alerts_enabled` is stored and returned by the server and **never read
  by the delivery pipeline**. It gates one client-drawn banner; putting it near
  `ShouldSuppressPush` would silence pushes too, which FR-012 forbids in as many
  words
- `backend/database/scripts/schema.sql`, `models.go`, `*.query.sql.go` and
  `*.pb.go` are **generated**. Regenerate them; never hand-edit
- No new dependency, service, table, screen, route or provider is added, and one
  file is deleted
- Commit after each task or logical group; stop at any checkpoint to validate a
  story independently
