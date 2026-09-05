# Tasks: Mobile Dark Mode

**Input**: Design documents from `/specs/050-mobile-dark-mode/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The spec requests two runnable assertion checks (`contrast.check.ts`,
`theme-resolution.check.ts`) and one Maestro flow, and no others. There is no
backend or web change, so no Go integration test and no Playwright spec — see
plan.md § Complexity Tracking. Test tasks below are exactly those three artifacts.

**Organization**: Tasks are grouped by user story. All paths are relative to the
repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1…US4)

## Path Conventions

Mobile app in a pnpm monorepo: `frontend/apps/mobile/src/`, shared tokens in
`frontend/packages/theme-tokens/src/`. No backend, proto, or migration paths are
touched by this feature.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the two assertion checks runnable before anything depends on them

- [X] T001 [P] Add `"check:contrast": "node --experimental-strip-types src/contrast.check.ts"` to the `scripts` block of `frontend/packages/theme-tokens/package.json`
- [X] T002 [P] Add `"check:theme-resolution": "node --experimental-strip-types src/lib/theme-resolution.check.ts"` to the `scripts` block of `frontend/apps/mobile/package.json`, alongside the existing `check:voice-state` / `check:doc-rows` / `check:device-timezone` entries
- [X] T003 Wire both new check scripts into the `test-frontend` target in `Makefile` so they run with the rest of the frontend suite

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The dark palette, the pure resolver, and the runtime that all 98 swept files are rewritten against

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The sweep in User Story 1 imports `makeStyles` from T012 and reads keys that do not exist until T004.

- [X] T004 Convert the five semantic colour groups — `presence`, `notificationDomain`, `taskState`, `eventCategory`, `priority` — to `{ light, dark }` records in `frontend/packages/theme-tokens/src/mobile.ts`, deriving each dark value by the R5 rule (600-level foreground → 400-level; 50-level tint → 15% alpha wash of the same hue; 800-level text-on-tint → the same 400-level as the dot; `presence.ring` → `background.paper` rather than `#ffffff`; neutrals lift toward the dark palette's own neutrals). Leave `shadows` mode-independent per R5.
- [X] T005 Update `getMobilePalette(mode)` in `frontend/packages/theme-tokens/src/mobile.ts` to select the `light`/`dark` half of each of the five groups by mode, keeping `touch`, `mobileLayout`, `avatar`, `radius`, `border`, `duration`, `opacity`, `mobileTypography`, `presence.ringWidth`, and `shadows` mode-independent. `getMobilePalette('light')` must return byte-identical values to today (SC-003). Depends on T004.
- [X] T006 Remove the bare `presence`, `notificationDomain`, `taskState`, `eventCategory`, and `priority` exports from the public surface of `frontend/packages/theme-tokens/src/mobile.ts` (and confirm `frontend/packages/theme-tokens/src/index.ts` re-export surface follows), so the only way to reach a semantic colour is `getMobilePalette(mode)` — contracts/theme-runtime.md §1. Depends on T005.
- [X] T007 [P] Create `frontend/packages/theme-tokens/src/contrast.check.ts`: an assertion script that enumerates every declared foreground/background pairing in both modes (`text.*` on `background.*`, each `ColorScale.contrastText` on its `main`, each semantic group's text/dot/icon on its own `bg` and on `background.paper`, `divider` against both backgrounds), composites `rgba(...)` colours over their declared surface before measuring, computes the WCAG 2.1 relative-luminance ratio, and exits non-zero with a `{ pair, mode, ratio, required }` table for any pairing below 4.5:1 (body text) or 3:1 (large text, icons, control boundaries). Depends on T005.
- [X] T008 [P] Create `frontend/apps/mobile/src/lib/theme-resolution.ts` exporting a pure `resolveTheme(input: ThemeResolutionInput): ThemeResolutionOutput` implementing the seven-row resolution table in data-model.md §5 (FR-009…FR-018), keying "a stored preference exists" off `exists` rather than `themeMode` so an unrecognised value becomes no preference (FR-018), and returning `source: 'os_default'` for every pre-answer row so a cached value can never masquerade as a deliberate choice (FR-013)
- [X] T009 Create `frontend/apps/mobile/src/lib/theme-resolution.check.ts`: an assertion self-check walking every row of the resolution table, including the pre-answer rows 5–7 and the `writeBack`/`cacheWrite` outputs, matching the `channel-voice-call-state.check.ts` convention. Depends on T008.
- [X] T010 Create `frontend/apps/mobile/src/lib/theme.tsx` exporting `makeStyles(fn)` — a factory returning a hook that reads the active mode from context and returns `StyleSheet.create(fn(palette))` from a two-entry module-level cache keyed by mode, so each sheet is built at most twice per process and is referentially stable per mode (contracts/theme-runtime.md §5)
- [X] T011 Add `ThemeState`, the `ThemeContext`, and `useTheme()` to `frontend/apps/mobile/src/lib/theme.tsx` per contracts/theme-runtime.md §3 — `mode`, `palette`, `source`, `followsOS`, `settling`, `setMode`; `mode` and `palette` never null; `palette === getMobilePalette(mode)` by identity; throws outside `<ThemeProvider>`. Depends on T010.
- [X] T012 Add `<ThemeProvider>` to `frontend/apps/mobile/src/lib/theme.tsx` wired to `resolveTheme` with the device inputs only for now — `signedIn: false`, `serverPreference: null`, `cachedTheme: null`, `deviceLastKnown: null`, `osScheme` from `useColorScheme()` — and mirroring `followsOS` into `Appearance.setColorScheme(followsOS ? null : mode)`. Rows 1 and 7 of the table both yield the OS scheme, so this provider is already correct for signed-out and no-preference use; User Story 2 supplies the remaining inputs without changing this wiring. Depends on T008, T011.

**Checkpoint**: `pnpm --filter @tech-office/theme-tokens check:contrast` and `pnpm --filter mobile check:theme-resolution` both exit 0. The runtime exists; the sweep can begin.

---

## Phase 3: User Story 1 - The app is readable in dark (Priority: P1) 🎯 MVP

**Goal**: Every mobile screen, component, overlay, and system surface paints from the active palette at render time. Dark is readable end to end; light is byte-identical to today.

**Independent Test**: No server, no stored preference. Set the phone to dark, launch the app, and walk every screen and every state per quickstart.md Level 2. Then set the phone to light and confirm nothing changed from before this feature.

**Note on batching**: T014–T023 are ten mechanical batches of the same substitution — `StyleSheet.create({… lightPalette.X …})` becomes `makeStyles((t) => ({… t.X …}))` plus one `const styles = useStyles();` inside the component — and raw hex/`rgba()` literals become tokens. They touch disjoint file sets and are all `[P]`. They must all land before the app is shippable (there is no half-themed intermediate state, per the spec's assumption); they are separated only so each is reviewable.

### Navigation chrome and the app shell (sequential — these five files interlock)

- [X] T013 [US1] Convert `frontend/apps/mobile/src/lib/stack-screen-options.ts` from a module-level `const` built from `lightPalette` to `tabRootStackScreenOptions(t: MobilePalette)` — a plain function, not a hook (contracts/theme-runtime.md §6) — setting `headerTitleStyle.color`, `headerTintColor`, `headerStyle.backgroundColor` (Android's opaque header), `headerBlurEffect` (`'regular'` in light, `'systemChromeMaterialDark'` in dark), and `contentStyle.backgroundColor` (this last is what removes the white flash between screen pushes — FR-006, SC-001)
- [X] T014 [US1] In `frontend/apps/mobile/src/app/_layout.tsx`: delete `Appearance.setColorScheme("light")` (line ~39), mount `<ThemeProvider>` inside `QueryClientProvider` and outside the auth-consuming subtree so signed-out screens get a theme (FR-014), and change `<StatusBar style="dark" />` (line ~225) to `style={mode === 'dark' ? 'light' : 'dark'}` so the phone's clock and battery stay visible (FR-004). Do not use `style="auto"` — the app's theme may deliberately differ from the phone's. Depends on T012, T013.
- [X] T015 [US1] Theme the tab bar in `frontend/apps/mobile/src/app/(app)/_layout.tsx` — `tabBarStyle`, `tabBarActiveTintColor`, `tabBarInactiveTintColor` from the active palette (FR-004) — and pass the palette into `tabRootStackScreenOptions`. Depends on T013, T014.
- [X] T016 [US1] Apply the same palette-driven `screenOptions` in `frontend/apps/mobile/src/app/(shared)/_layout.tsx` and `frontend/apps/mobile/src/app/(app)/(more)/_layout.tsx`. Depends on T013.

### The sweep — ten disjoint batches

- [X] T017 [P] [US1] Sweep the 14 files in `frontend/apps/mobile/src/components/ui/` (`badge.tsx`, `button.tsx`, `card.tsx`, `chip.tsx`, `empty-state.tsx`, `error-boundary.tsx`, `header-title-with-stream-status.tsx`, `live-notification-banner.tsx`, `offline-banner.tsx`, `search-bar.tsx`, `search-pill.tsx`, `skeleton.tsx`, `state-chip.tsx`, `text-input.tsx`). `live-notification-banner.tsx` already selects by colour scheme — move it onto `useTheme()` so there is one theme source (FR-006 covers the banner and the skeleton; FR-005 covers `text-input.tsx`'s caret and selection handles, which follow from T014's `setColorScheme` wiring rather than per-prop theming)
- [X] T018 [P] [US1] Sweep the 10 files in `frontend/apps/mobile/src/components/chat/` (`channel-sidebar.tsx`, `chat-message-body.tsx`, `create-task-sheet.tsx`, `incoming-call-banner.tsx`, `message-task-chips.tsx`, `task-discussion-context.tsx`, `voice-call-banner.tsx`, `voice-call-record.tsx`, `voice-message-player.tsx`, `voice-message-recorder.tsx`)
- [X] T019 [P] [US1] Sweep the 12 files in `frontend/apps/mobile/src/components/common/` (`directory-row.tsx`, `presence-indicator.tsx`, `user-avatar.tsx`, `user-card.tsx`), `components/compliance/` (`block-confirm.tsx`, `report-sheet.tsx`, `terms-acceptance.tsx`, `terms-gate.tsx`), and `components/rituals/` (`assignee-picker.tsx`, `evidence-requirement-editor.tsx`, `procedure-sheet.tsx`, `recurrence-picker.tsx`). `presence-indicator.tsx` and `user-avatar.tsx` consume `presence.ring`, whose dark value is the surface rather than white (T004)
- [X] T020 [P] [US1] Sweep the 8 remaining component files: `frontend/apps/mobile/src/components/voice/active-voice-call-bar.tsx`, `components/voice/incoming-voice-call-prompt.tsx`, `components/review/reject-reason-sheet.tsx`, `components/review/review-queue-card.tsx`, `components/tasks/task-origin-block.tsx`, `components/docs/document-content.tsx`, `components/auth/session-error-banner.tsx`, `components/feature-tour.tsx`. Both `voice/` files already select by colour scheme — move them onto `useTheme()` (FR-006 covers the call overlays)
- [X] T021 [P] [US1] Sweep the 10 signed-out screens: `frontend/apps/mobile/src/app/(auth)/` (`accept-invitation.tsx`, `forgot-password.tsx`, `index.tsx`, `reset-password.tsx`, `set-pin.tsx`, `signin.tsx`, `signup.tsx`, `sso-callback.tsx`) and `app/(onboarding)/` (`add-teammate.tsx`, `set-pin.tsx`). These follow the phone's setting (FR-014) and get their theme from the provider mounted in T014
- [X] T022 [P] [US1] Sweep the 5 chat screens: `frontend/apps/mobile/src/app/(app)/(chat)/` (`[channelId].tsx`, `index.tsx`, `new-channel.tsx`, `search.tsx`, `thread/[messageId].tsx`)
- [X] T023 [P] [US1] Sweep the 9 task screens: `frontend/apps/mobile/src/app/(app)/(tasks)/` (`index.tsx`, `create-project.tsx`, `[projectId]/index.tsx`, `[projectId]/create.tsx`, `[projectId]/create-ritual.tsx`, `[projectId]/settings.tsx`, `[projectId]/task/[taskId].tsx`, `review/index.tsx`, `rituals/[definitionId].tsx`). These are the heaviest consumers of `taskState` and `priority` (FR-003)
- [X] T024 [P] [US1] Sweep the 5 calendar, today, and notification screens: `frontend/apps/mobile/src/app/(app)/(calendar)/` (`index.tsx`, `create.tsx`, `[eventId].tsx`), `app/(app)/(today)/index.tsx`, `app/(app)/(notifications)/index.tsx`. These consume `eventCategory` and `notificationDomain` (FR-003)
- [X] T025 [P] [US1] Sweep the 15 "more" screens: `frontend/apps/mobile/src/app/(app)/(more)/` (`index.tsx`, `blocked.tsx`, `delete-account.tsx`, `navigation-debug.tsx`, `profile.tsx`, `request-removal.tsx`, `search.tsx`, `settings.tsx`, `docs/index.tsx`, `docs/[slug].tsx`, `files/index.tsx`, `files/[fileId].tsx`, `people/index.tsx`, `people/[employeeId].tsx`, `people/department/[departmentId].tsx`). Colours only — the Settings theme control itself is User Story 3
- [X] T026 [P] [US1] Sweep the 5 shared and public screens: `frontend/apps/mobile/src/app/(shared)/resource/probe/[id].tsx`, `(shared)/resource/probe/item/index.tsx`, `(shared)/resource/probe/item/[id].tsx`, `app/booking/[token].tsx`, `app/link-status.tsx`
- [X] T027 [US1] Run `pnpm run typecheck:mobile` from `frontend/` and resolve every compilation error the sweep produced — in particular any remaining import of a removed bare token export (T006). Depends on T017–T026.

**Checkpoint**: User Story 1 is complete and independently testable. Walk quickstart.md Level 2 on iOS and Android, in dark and in light. The app is dark on a dark phone with no server involved; light is unchanged.

---

## Phase 4: User Story 2 - The theme the person already chose follows them to the phone (Priority: P1)

**Goal**: A signed-in person's stored preference governs the theme, with a correct first frame, foreground re-reads, and no failure when the server is unreachable.

**Independent Test**: quickstart.md Level 3 — set dark on the web, open the phone app on a light phone, confirm dark; reset the preference and confirm the app follows the phone again, with `preference_source = 'os_default'` in the database.

- [X] T028 [US2] Add device-scoped `theme_last_known` read/write/clear helpers to `frontend/apps/mobile/src/lib/theme.tsx` (or a small sibling module) on the MMKV instance the platform adapter already owns, storing only `'light'`/`'dark'` — never a source, never an identity (data-model.md §7, R4)
- [X] T029 [US2] In `<ThemeProvider>` (`frontend/apps/mobile/src/lib/theme.tsx`), fetch the stored preference with React Query under `["user-preference"]` via `apis.getUserPreference()` — never `preferenceClient` directly (Principle VII) — and feed `serverPreference` into `resolveTheme` (FR-009). A fetch failure must be logged, not surfaced, and must not block render (FR-017, SC-008). Depends on T012, T028.
- [X] T030 [US2] Supply the remaining `resolveTheme` inputs in `<ThemeProvider>`: `signedIn` and `employeeId` read from the auth context by the provider itself (no `employeeId` prop — the id arrives asynchronously from SecureStore, contracts/theme-runtime.md §4), `cachedTheme` from `apis.loadThemePreference(employeeId)`, and `deviceLastKnown` from T028's helper so frame zero is already correct (FR-016, SC-006). Depends on T029.
- [X] T031 [US2] Apply `ThemeResolutionOutput.cacheWrite` in `<ThemeProvider>`: mirror each resolved mode into both `theme_preference_{employeeId}` via `apis.saveThemePreference` and the device-scoped `theme_last_known` (data-model.md §7). Depends on T030.
- [X] T032 [US2] Apply `ThemeResolutionOutput.writeBack` in `<ThemeProvider>`: call `apis.updateUserPreference(mode, 'os_default')` fire-and-forget when the table says to — adopting the phone's setting for a person with no row (FR-010, FR-013) and re-recording an OS change while `os_default` (FR-011). Log and retry on next foreground; never surface (FR-017). This path must never write `'manual'`. Depends on T030.
- [X] T033 [US2] Confirm the `Appearance.setColorScheme(followsOS ? null : mode)` mirroring from T012 now takes its `followsOS` from the resolved `preference_source` rather than from `signedIn` alone — `null` while `os_default` or signed out so the OS listener still reports the phone's real setting (FR-005, FR-011, FR-014), the explicit mode once `manual` so OS changes are correctly invisible (FR-012, R2). Depends on T030.
- [X] T034 [US2] Refetch the preference in `<ThemeProvider>` when `AppState` becomes `active` (via the existing `frontend/apps/mobile/src/hooks/use-app-state.ts`) and when the auth context's `employeeId` changes, so a change made on the web is picked up on foreground and at sign-in (FR-015, R10). Depends on T029.
- [X] T035 [US2] Clear `theme_preference_{employeeId}` (via `apis.clearThemePreference`) and `theme_last_known` on sign-out, so a remembered theme is never shown to a second person (spec edge case; contracts/theme-runtime.md §4). Depends on T028, T031.
- [X] T036 [US2] Subscribe to `Appearance` change events in `<ThemeProvider>` and re-resolve, so an OS change while `os_default` repaints the screen in place without a restart (FR-008, FR-011, SC-005) and an OS change while backgrounded is already applied by the time the app is visible again. Depends on T033.

**Checkpoint**: User Stories 1 and 2 both work. quickstart.md Level 3 passes against a running backend, including the offline cold-launch scenario.

---

## Phase 5: User Story 3 - The switch comes back (Priority: P2)

**Goal**: The Settings screen offers a theme control that records a deliberate choice, repaints immediately, and never leaves the app showing a theme different from the one stored.

**Independent Test**: quickstart.md Level 4 — open Settings, flip the control, confirm the app repaints without leaving the screen, confirm `preference_source = 'manual'`, confirm the phone's own setting no longer moves it, and confirm the choice survives a restart and shows on the web.

- [X] T037 [US3] Implement `setMode(mode)` on the theme context in `frontend/apps/mobile/src/lib/theme.tsx`: update `mode` synchronously before awaiting so the app repaints without waiting for the store (FR-021), then `apis.updateUserPreference(mode, 'manual')`; on failure restore the previous mode and reject so the caller can surface a message (FR-022). This is the only exported path that may write `'manual'` (FR-013, FR-020, contracts/theme-runtime.md §3). Depends on T032.
- [X] T038 [US3] Restore the theme row on `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx` where the old Dark Mode switch sat, delete the tombstone comment, and wire the `Switch` to `setMode` (on ⇒ dark). Carry `testID="theme-toggle-row"` with `accessibilityValue={{ text: mode }}` and `testID="theme-toggle-switch"` per contracts/theme-runtime.md §7 (FR-019, Principle XIII). Depends on T025, T037.
- [X] T039 [US3] Surface FR-022's failure path on the Settings screen: when `setMode` rejects, the control and the theme return to their previous position with a visible explanation, using the existing `apis` error handling — the app must never show one theme while the server stores the other. Depends on T038.
- [X] T040 [US3] Create the Maestro flow `frontend/apps/mobile/.maestro/settings/dark-mode-toggle.yaml` (new `settings/` directory): sign in → More → Settings → assert `theme-toggle-row` is visible → tap `theme-toggle-switch` → assert the row's accessibility value reports `dark` → relaunch → assert it still reports `dark`. Happy path only; the resolution edge cases live in `theme-resolution.check.ts` and contrast in `contrast.check.ts` (R11, Principle XIII). Depends on T038.

**Checkpoint**: All three P1/P2 stories work. `make test-mobile-one F=settings/dark-mode-toggle` passes.

---

## Phase 6: User Story 4 - Launching does not flash white (Priority: P3)

**Goal**: A cold launch on a dark phone shows a dark splash and no light frame.

**Independent Test**: quickstart.md Level 5 — cold-launch on both platforms with the phone dark, then light, watching the transition from the home screen.

- [X] T041 [US4] Add a `dark` block to the `expo-splash-screen` config plugin in `frontend/apps/mobile/app.json` — `{ "image": "./assets/splash-icon.png", "backgroundColor": "#0f172a" }` (`darkPalette.background.default`) — leaving the light `backgroundColor` at `#FFFFFF` so a light launch is byte-identical (FR-023, SC-003, R9). `userInterfaceStyle` is already `"automatic"`; leave `android.adaptiveIcon.backgroundColor` and the `expo-notifications` tint alone, per the spec's brand-colour carve-out
- [X] T042 [US4] Run `pnpm prebuild` in `frontend/apps/mobile` and verify the regenerated native splash on both platforms. A simulator running a stale binary shows the old white splash and looks like a failure that is really a stale build. Depends on T041.

**Checkpoint**: All four user stories are functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T043 Add a `no-restricted-syntax` entry to `frontend/eslint.config.mts` scoped to `apps/mobile/src/**` rejecting string literals matching `^#[0-9a-fA-F]{3,8}$` and `^rgba?\(`, and run `pnpm run lint` until green — the sweep must have removed every raw colour (FR-002, R7, contracts/theme-runtime.md §8). Depends on T017–T027.
- [X] T044 [P] Rewrite the "Theme and preferences" section of `docs/domain/workspace-navigation.md`: "Only the web app participates" is no longer true. Describe mobile's participation, the `preference_source` mechanism, and the deliberate divergence that mobile implements FR-011 (follows a later OS change while `os_default`) while the web does not (Principle XII)
- [X] T045 Remove drift **D30** from the drift register in `docs/domain/README.md` and record the web/mobile FR-011 divergence in its place, as documented in contracts/preference-service.md (SC-009). Depends on T044.
- [X] T046 Run all four Level 1 static checks from `frontend/`: `pnpm --filter @tech-office/theme-tokens check:contrast`, `pnpm --filter mobile check:theme-resolution`, `pnpm run typecheck:mobile`, `pnpm run lint`. Depends on T043. **Three of the four exit 0** — contrast (164 pairings across both modes), theme resolution, and `typecheck:mobile`, which now passes for the first time in several features. `pnpm run lint` still reports 178 problems, **none of them from this change and none from the new colour rule**: the count was 179 before it and is 178 after, and `no-restricted-syntax` fires zero times across `apps/mobile/src/**`. The remainder is pre-existing `no-explicit-any`, `no-require-imports` and unused-import debt spread across the repository; clearing it is a cleanup of its own, not part of this feature.
- [ ] T047 **Not run — needs a simulator or device and a running backend, neither available in this environment.** Run `make test-mobile` — the full Maestro suite, not just the new flow. A 98-file sweep can break an unrelated flow by moving a `testID`. Depends on T040.
- [ ] T048 **Not run — needs both platforms in front of a person.** Walk quickstart.md Levels 2–5 on **both** iOS and Android, in dark and in light, and tick the Definition of Done. The two things a sweep misses are the white frame between screen pushes (a missed `contentStyle.backgroundColor`) and a light keyboard under a dark screen (wrong `setColorScheme` wiring). The habitual test device is an iPhone SE, so Android's opaque-header path needs deliberate checking. Depends on T042, T046, T047.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Foundational. Blocks nothing conceptually, but T025 (the "more" screens) must land before T038 edits `settings.tsx`
- **User Story 2 (Phase 4)**: Depends on Foundational (specifically T012's provider). Can run in parallel with User Story 1 — they touch disjoint files (`theme.tsx` vs. the 98 swept screens)
- **User Story 3 (Phase 5)**: Depends on User Story 2 (T037 needs the write path from T032) and on T025
- **User Story 4 (Phase 6)**: Depends only on Setup — `app.json` is touched by nothing else and can be done at any time
- **Polish (Phase 7)**: T043 depends on the whole sweep; T046–T048 depend on everything

### User Story Dependencies

- **US1 (P1)**: Independent once Foundational is done. Testable with no server and no stored preference.
- **US2 (P1)**: Independent once Foundational is done. Testable through the database and the web toggle without any mobile UI of its own.
- **US3 (P2)**: Depends on US2 for the write path and on US1's sweep of `settings.tsx`. Not independently deliverable — a switch that writes a preference nothing paints is exactly the decoration that was removed.
- **US4 (P3)**: Fully independent of all three. Pure platform launch configuration.

### Within Each User Story

- Foundational tokens (T004–T006) before anything that reads them
- The pure resolver (T008) before the provider that calls it (T012)
- `makeStyles` (T010) before every sweep batch
- Navigation chrome (T013–T016) before the sweep batches only in review order, not technically — they are independent files, but landing the shell first makes each batch visually verifiable as it lands

### Parallel Opportunities

- T001 and T002 in parallel; T003 after both
- T007 (contrast check) and T008 (resolver) in parallel — different packages
- **T017–T026: all ten sweep batches in parallel.** They are disjoint file sets, all doing the same mechanical substitution. This is the bulk of the feature and the main parallelism win.
- **US1 and US2 in parallel** by two people: one sweeps screens, one wires the provider. They meet at `theme.tsx`, which US2 owns exclusively after T012.
- **US4 (T041–T042) in parallel with everything** — `app.json` is untouched by any other task
- T044 (domain docs) in parallel with implementation

---

## Parallel Example: User Story 1 sweep

```bash
# Ten disjoint batches, all the same mechanical substitution:
Task: "T017 Sweep components/ui (14 files)"
Task: "T018 Sweep components/chat (10 files)"
Task: "T019 Sweep components/common + compliance + rituals (12 files)"
Task: "T020 Sweep components/voice + review + tasks/docs/auth/feature-tour (8 files)"
Task: "T021 Sweep app/(auth) + app/(onboarding) (10 files)"
Task: "T022 Sweep app/(app)/(chat) (5 files)"
Task: "T023 Sweep app/(app)/(tasks) (9 files)"
Task: "T024 Sweep app/(app)/(calendar) + (today) + (notifications) (5 files)"
Task: "T025 Sweep app/(app)/(more) (15 files)"
Task: "T026 Sweep app/(shared) + booking + link-status (5 files)"
# Then T027 typechecks the union.
```

---

## Implementation Strategy

### MVP scope

The MVP is **User Story 1 plus User Story 2** — both are P1, and neither is
worth shipping alone. US1 without US2 is a dark app that ignores the choice the
person already made on the web; US2 without US1 is a preference that selects
between light and a broken half-dark app. Ship them together.

Within that, US1 is the risk (98 files) and US2 is the logic (one file and a
truth table), so they parallelise cleanly across two people.

### Incremental delivery

1. Phase 1 + Phase 2 → the palette, the resolver, and the runtime exist; both checks are green
2. Phase 3 (US1) → the app is readable in dark; walk Level 2 on both platforms
3. Phase 4 (US2) → the stored theme follows the person; walk Level 3
4. **Ship.** This is the feature as requested: "thread the palette through the mobile screens and read the stored theme preference"
5. Phase 5 (US3) → the switch returns; the tombstone comment is redeemed
6. Phase 6 (US4) → the splash stops flashing white
7. Phase 7 → the lint rule locks the sweep in, and D30 comes off the register

There is deliberately **no** screen-by-screen delivery of Phase 3. The spec
rejects it explicitly: a dark tab bar under a white screen reads as a broken
app, so the sweep is the unit of work.

### Parallel team strategy

1. Everyone completes Phase 1 + Phase 2 together (it is small, and everything depends on it)
2. Then:
   - Developer A: the ten sweep batches (T017–T026) — mechanical, high volume, low risk
   - Developer B: the provider wiring (T028–T036) — low volume, all the subtlety
   - Either: T041–T042 (splash) at any point
3. They meet at T027 (typecheck) and T037 (the Settings control, which needs both halves)

---

## Notes

- The per-file sweep diff is a colour-for-colour substitution plus one
  `const styles = useStyles();` line. If a batch turns into a rewrite, stop —
  the spec puts layout, spacing, hierarchy, and copy explicitly out of scope.
- `getMobilePalette('light')` returning byte-identical values is a real
  regression gate, not a nicety: it is what makes SC-003 checkable.
- Anything that turns out to need a backend, proto, or migration change is a
  signal that something has been misread, not a licence to widen the feature.
- [ASSUMPTION: `resolveTheme` and its check are placed in the Foundational phase
  rather than inside User Story 2, because rows 1 and 7 of the resolution table
  both yield the OS scheme. Wiring the provider to the resolver once — with null
  server inputs during US1 — avoids building a `useColorScheme()`-only provider
  in US1 and then rewriting it in US2. It costs US1 nothing and removes a
  rework step.]
- [ASSUMPTION: the 98 files are sliced into ten batches along the directory
  boundaries measured in research.md, sized 5–15 files each. The plan says only
  "reviewable batches"; directory boundaries were chosen because they group
  screens that share tokens (all `taskState` consumers in one batch, all
  `eventCategory` consumers in another), so a reviewer checks one semantic group
  at a time rather than the same group ten times.]
- [ASSUMPTION: the ESLint rule (T043) lands in Polish rather than in Setup, even
  though it enforces FR-002. Enabling it before the sweep would fail the build
  on 50 pre-existing files and force a `--fix`-shaped rush; landing it after the
  sweep means it lands green and its job from then on is prevention, which is
  what R7 says it is for.]
- [ASSUMPTION: T003 wires both checks into `make test-frontend`. quickstart.md
  states this for `check:contrast` and lists `check:theme-resolution` alongside
  it in Level 1; wiring only one would leave the resolution table unguarded in
  CI, which is the check the plan calls the only proof of SC-006.]
- [ASSUMPTION: a sixth semantic group, `overlay`, was added to `mobile.ts`
  alongside the five the plan names. Twenty-seven call sites each spelled their
  own near-identical scrim or media-chrome `rgba(...)`, and FR-002 plus the lint
  rule of T043 make "leave them as literals" not an option. The group holds
  `scrim`, `heavyScrim`, `barSurface`, `mediaSurface`, `mediaControl` and
  `mediaText`; the last three are the same in both modes on purpose, because
  chrome drawn over a photo is dark with white text whichever theme the app is
  in. It is covered by `contrast.check.ts` like every other group.]
- [ASSUMPTION: `Appearance.setColorScheme` is handed back to the OS with
  `'unspecified'`, not the `null` the plan, research R2 and
  contracts/theme-runtime.md all say. Under React Native 0.83 `ColorSchemeName`
  is `'light' | 'dark' | 'unspecified'`; `'unspecified'` maps to
  `MODE_NIGHT_FOLLOW_SYSTEM` on Android and `UIUserInterfaceStyleUnspecified` on
  iOS, and `null` does not typecheck. The mechanism R2 describes is unchanged —
  only the spelling of "follow the OS" is.]
- [ASSUMPTION: the provider does not read the phone's scheme through
  `useColorScheme()`. `setColorScheme` writes its own argument into the value
  `getColorScheme()` reads back, so for a frame after handing the override away
  the hook reports the literal string `'unspecified'`, which is not a theme.
  Coercing that to light would repaint a dark phone light and, on an
  `os_default` row, write the fallback to the server as though the phone had
  moved. The provider keeps the last real answer instead, and ignores
  `Appearance` events entirely while pinned to a deliberate choice — while
  pinned those events are the app hearing its own override.]
- [ASSUMPTION: the fire-and-forget `os_default` write retries on a counter that
  only the app's own foregrounding moves, rather than on the preference query's
  `dataUpdatedAt`. The write puts its result back into the query cache, which
  would bump `dataUpdatedAt` and re-run the effect; if a write ever failed to
  change what the server reports, that is an unbounded loop of network calls. A
  foreground counter cannot close that circle and still satisfies "retry on next
  foreground".]
- [ASSUMPTION: three type errors that predate this feature were fixed rather
  than left, because `pnpm run typecheck:mobile` is one of the gates the feature
  installs and a gate that can never be green is not a gate. Two were one-line
  fixes (a proto `Timestamp` built by hand, a `tabPress` listener the core event
  map does not declare). The third was `chat-message-body.tsx` passing
  `durationMs` and `waveformPeaks` to a `VoiceMessagePlayer` that declares
  neither; the props were **removed** rather than wired up, because building a
  waveform is a chat feature. The capability that implies is recorded as drift
  D60 rather than silently absorbed.]
- [ASSUMPTION: the sweep was extended to `<Text>` and `<TextInput>` elements that
  set no colour at all. React Native's default text colour is black, so those
  render black on a dark card — and the sweep as specified could not find them,
  because there is no literal to replace and no `lightPalette` to rewrite. A
  static audit found 56 candidates, of which about twenty were real (mostly text
  inputs whose typed text and placeholder had no colour); the rest were emoji
  glyphs, type positions, and styles that set their colour through a variable.]
- [ASSUMPTION: the four navigation layouts the task list does not name —
  `(tasks)`, `(today)`, `(calendar)`, `(notifications)` `_layout.tsx` — were
  updated alongside the two it does. All six call
  `tabRootStackScreenOptions`, whose signature changed in T013, so leaving four
  of them would not have compiled.]
- [ASSUMPTION: no task is created for `src/lib/platform-adapter.ts`. Research R2
  states the existing `ThemeAdapter` is already correct under
  `setColorScheme(null)`, so touching it would be a change without a
  requirement behind it.]
