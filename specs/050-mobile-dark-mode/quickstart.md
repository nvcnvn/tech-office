# Quickstart: Validating Mobile Dark Mode

**Feature**: `050-mobile-dark-mode` | **Date**: 2026-09-05

How to prove this feature works, end to end, in the order the checks get
cheaper-to-more-expensive. Nothing here duplicates implementation detail — see
[contracts/](./contracts/) for interfaces and [data-model.md](./data-model.md)
for the resolution table.

---

## Prerequisites

```bash
# Backend + database (needed only for the preference-reading scenarios)
make dev-backend          # backend on :8080

# Mobile Metro + a dev client
cd frontend/apps/mobile && pnpm start        # Metro on :18082
pnpm ios                 # or: pnpm android
```

Both platforms must be checked. The habitual test device is an iPhone SE, which
is exactly the narrow screen where a dark surface stranded under a light header
is easiest to miss — and Android's opaque header path is a different code path
from iOS's blurred one.

---

## Level 1 — Static checks (seconds, no device)

```bash
cd frontend

pnpm --filter @tech-office/theme-tokens check:contrast   # SC-002, FR-007
pnpm --filter mobile check:theme-resolution              # FR-009…FR-018
pnpm run typecheck:mobile                                # the 98-file sweep compiles
pnpm run lint                                            # FR-002: no raw colours in mobile src
```

**Expect**: all four exit 0.

- `check:contrast` prints the number of pairings measured per mode. A failure
  prints `pair / mode / ratio / required` — the value is the specific token pair
  to fix, not "dark mode has a contrast problem".
- `check:theme-resolution` walks every row of the resolution table in
  [data-model.md §5](./data-model.md), including the pre-answer rows. This is the
  only check that can prove SC-006 ("never shows the other theme, not even for a
  frame"), because a blackbox driver cannot observe a single frame.
- `lint` failing on `apps/mobile/src/**` with `no-restricted-syntax` means a raw
  hex or `rgba()` literal survived the sweep.

## Level 2 — The app is readable in dark (US1, no server needed)

Sign-out is not required; this level tests painting, not preference.

1. Set the phone to **dark** (iOS: Settings → Display & Brightness; Android:
   Display → Dark theme).
2. Launch the app.
3. Walk every tab — **Chat, Today, My Work, More** — and from More: Settings,
   Profile, People, Docs, Files, Search, Blocked. From Chat: a channel, a
   thread, the bell. From My Work: a project, a task detail, Rituals, Review.
   From Today: the schedule. Plus the signed-out screens (sign in, set PIN,
   onboarding) and the public booking link.
4. On each screen, check the states, not just the resting view: the loading
   skeleton, the empty state, an error banner, an action sheet, a modal.
5. Trigger the overlays: an incoming call prompt, the active-call bar, an in-app
   notification banner, the offline banner.

**Expect** (SC-001): no light card on a dark background, no light-on-light text,
no light native control on a dark screen. The tab bar, headers, back chevrons,
and the status bar's clock/battery are all legible. Status colours — presence
dots, task states, priorities, event categories, notification domain badges —
are legible and still mean what they meant in light.

Two specific things to look for, because they are the ones a sweep misses:

- **Between screens.** Push and pop several screens quickly. A white frame
  between them means a `contentStyle.backgroundColor` was missed.
- **Text fields.** Focus one. The keyboard, the caret, and the selection handles
  must be dark. A light keyboard under a dark screen means the
  `Appearance.setColorScheme` wiring is wrong.

6. Set the phone back to **light** and repeat the walk.

**Expect** (SC-003): identical to the app before this feature. If anything moved
or changed shade, `getMobilePalette('light')` is no longer byte-identical and
that is a bug, not a refinement.

7. With the app in the foreground on a screen, change the phone's setting.

**Expect**: the screen you are looking at repaints without navigating away and
without a restart (FR-008, SC-005 — under one second).

## Level 3 — The stored theme follows the person (US2, backend required)

1. Sign in on the web as a test employee. Toggle to **dark** there.
2. On a phone set to **light**, open the mobile app and sign in as the same
   person.

   **Expect** (SC-004): the app is dark. No sign-out, no reinstall.

3. Background the mobile app. On the web, toggle back to **light**. Foreground
   the mobile app.

   **Expect**: it is light (FR-015).

4. Reset the person's preference (delete the `iam.user_preference` row, or call
   `ResetUserPreference` from the web). Set the phone to **dark**. Cold-launch
   the mobile app.

   **Expect**: the app is dark, and the row now reads
   `theme_mode = 'dark'`, `preference_source = 'os_default'` (FR-010, FR-013 —
   `manual` here would be the bug this requirement exists to prevent):

   ```sql
   SELECT theme_mode, preference_source FROM iam.user_preference WHERE employee_id = '<id>';
   ```

5. With that row still `os_default`, change the phone to **light**.

   **Expect**: the app follows, and the row is still `os_default` (FR-011). This
   is the behaviour the web client does *not* have; see
   [contracts/preference-service.md](./contracts/preference-service.md).

6. Sign out, sign in as a **different** person who has a different stored theme.

   **Expect**: the second person's theme, never the first person's — including
   during the loading frames.

7. Stop the backend. Cold-launch the app.

   **Expect** (SC-008): it opens in that person's last known theme, with no
   error about the theme and no hang on the splash. Restart the backend,
   foreground the app, and it corrects itself if the server disagrees.

## Level 4 — The switch (US3)

1. In the app, go to **More → Settings**. The theme row sits where the old Dark
   Mode switch was.
2. Flip it.

   **Expect**: the whole app repaints immediately, without leaving Settings and
   without a restart (FR-021, SC-005). The row's accessibility value reports the
   new mode.

3. Change the phone's system setting.

   **Expect**: nothing changes — the choice is now `manual` (FR-012). Confirm
   `preference_source = 'manual'` in the database.

4. Cold-restart the app, and open the web app.

   **Expect**: the chosen theme in both places (SC-006).

5. Turn on airplane mode and flip the control.

   **Expect** (FR-022): the app repaints immediately, and then either the write
   lands when the network returns, or the control and the theme return to their
   previous position with a visible message. What must *not* happen is the app
   showing one theme while the server stores the other.

## Level 5 — Launch (US4)

1. Fully quit the app. Set the phone to **dark**. Cold-launch it while watching
   the transition from the home screen.

   **Expect** (SC-007): the splash is dark; there is no light frame between the
   home screen and the first painted app screen.

2. Repeat with the phone set to **light**.

   **Expect**: exactly as today.

Do this on **both** platforms. The splash is native configuration regenerated by
`expo prebuild`; a simulator running a stale build will show the old white
splash and look like a failure that is really a stale binary.

## Level 6 — Blackbox flow (Principle XIII)

```bash
make test-mobile-one F=settings/dark-mode-toggle
make test-mobile                      # full suite — the sweep must not regress other flows
```

The flow covers the happy path only: sign in → Settings → flip → assert the
theme row reports `dark` → relaunch → assert it still reports `dark`. It asserts
through an accessibility value rather than a colour, because Maestro is a
blackbox driver with no pixel assertions. The full suite matters here more than
usual: a 98-file sweep can break an unrelated flow by moving a `testID`.

---

## Definition of Done for this feature

- [ ] Level 1 static checks all green
- [ ] Level 2 walked on iOS **and** Android, in dark and in light
- [ ] Level 3 scenarios verified against a running backend, with the
      `preference_source` values confirmed in the database
- [ ] Level 4 and 5 verified on both platforms
- [ ] `make test-mobile` green
- [ ] `docs/domain/workspace-navigation.md` § "Theme and preferences" rewritten
      to describe mobile's participation, and **D30 removed** from the drift
      register in `docs/domain/README.md` (SC-009) — with the deliberate
      web/mobile divergence on FR-011 recorded in its place
- [ ] The tombstone comment in `src/app/(app)/(more)/settings.tsx` is gone,
      because the thing it promised has arrived
