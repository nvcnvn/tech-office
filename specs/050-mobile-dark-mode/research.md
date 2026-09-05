# Phase 0 Research: Mobile Dark Mode

**Feature**: `050-mobile-dark-mode` | **Date**: 2026-09-05

**Input**: [spec.md](./spec.md)

This document resolves every unknown in the plan's Technical Context. Each entry
records what was chosen, why, and what was rejected. Choices made without an
explicit instruction in the spec are marked `[ASSUMPTION: …]` so they can be
reviewed.

---

## Current-state inventory (measured, not assumed)

Counts taken from `frontend/apps/mobile/src` on branch `050-mobile-dark-mode`:

| Fact | Count |
|------|-------|
| TypeScript/TSX files under `src/` | 169 |
| Files importing `lightPalette` by name | 73 |
| Files calling `StyleSheet.create` | 76 |
| Files containing a raw hex colour literal | 50 |
| **Union — files this feature must touch** | **98** |

By area: `app/(app)` 36, `components/ui` 14, `components/chat` 10,
`app/(auth)` 8, `components/rituals` 4, `components/compliance` 4,
`components/common` 4, `app/(shared)` 4, `components/voice` 2,
`components/review` 2, `app/(onboarding)` 2, plus nine single files
(`lib/stack-screen-options.ts`, `app/_layout.tsx`, `app/link-status.tsx`,
`app/booking`, `components/tasks`, `components/docs`, `components/auth`,
`components/feature-tour.tsx`).

What already exists and is reused unchanged:

- `@tech-office/theme-tokens` exports `lightPalette`, `darkPalette`,
  `getPalette(mode)`, `getMobilePalette(mode)` and `statusColors` (which already
  has light *and* dark variants).
- `apis` exports `getUserPreference`, `updateUserPreference`,
  `resetUserPreference`, `saveThemePreference`, `loadThemePreference`,
  `clearThemePreference`, `detectOSTheme`. All platform-neutral; the mobile
  platform adapter (`src/lib/platform-adapter.ts`) already wires MMKV storage
  and an `Appearance`-backed `ThemeAdapter`.
- `PreferenceService` on the backend, unchanged — no proto, migration, or Go
  change is in scope.

What blocks dark today:

- `src/app/_layout.tsx:39` — `Appearance.setColorScheme("light")`.
- `src/app/_layout.tsx:225` — `<StatusBar style="dark" />`.
- `src/lib/stack-screen-options.ts` — module-level header options built from
  `lightPalette`.
- 73 modules that resolve a palette **at import time** rather than at render
  time.
- `getMobilePalette` spreads *light-only* constants for `presence`,
  `notificationDomain`, `taskState`, `eventCategory`, `priority` — it varies the
  base palette by mode but returns the same semantic colours for both.

Three components (`components/ui/live-notification-banner.tsx`,
`components/voice/active-voice-call-bar.tsx`,
`components/voice/incoming-voice-call-prompt.tsx`) already do
`getPalette(useColorScheme())` correctly and are dead code only because the
scheme is pinned.

---

## R1 — How does a runtime palette reach 98 files?

**Decision**: A tiny local factory, `makeStyles`, in
`frontend/apps/mobile/src/lib/theme.tsx`:

```ts
export const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.background.paper } }));
// in the component:  const styles = useStyles();
```

`makeStyles(fn)` returns a hook that reads the active theme from context and
returns `StyleSheet.create(fn(palette))`, memoised in a two-entry module-level
cache keyed by mode. Because there are exactly two palettes, every sheet is
built at most twice for the life of the process — the same cost profile as
today's import-time `StyleSheet.create`, with none of the per-render allocation
a naive `useMemo` in every component would add.

The per-file diff is mechanical and reviewable:

```diff
-const styles = StyleSheet.create({
-  card: { backgroundColor: lightPalette.background.paper },
+const useStyles = makeStyles((t) => ({
+  card: { backgroundColor: t.background.paper },
 }));
```

plus one `const styles = useStyles();` line inside each component that renders
the sheet.

**Rationale**: It is the smallest change that satisfies FR-001 without a new
dependency or a new styling paradigm across 98 files. It preserves the existing
shape of every stylesheet, so a reviewer reads a colour-for-colour substitution
rather than a rewrite. It keeps `StyleSheet.create`'s registration benefits.

**Alternatives considered**:

- *NativeWind v5 / Tailwind* — replaces every `style={styles.x}` with class
  strings across 98 files. A rewrite disguised as a theming fix, with a new
  Babel/Metro configuration surface and a second source of truth for tokens
  beside `theme-tokens`. Rejected.
- *react-native-unistyles* — genuinely good at this (C++ theme swap without
  re-render) but adds a native module to a repo that already ships four native
  dependencies it must keep building on two platforms, to solve a re-render cost
  we have not measured and that only occurs when a person changes their theme.
  Rejected as disproportionate.
- *`@react-navigation/native` `useTheme()` as the app-wide theme source* —
  couples the whole app's palette to navigation's four-colour theme object,
  which does not carry `taskState`, `priority`, or the rest. Rejected.
- *Inline `style={[styles.card, { backgroundColor: t.background.paper }]}` at
  every call site* — leaves the colour split across two places per element and
  allocates a new object on every render. Rejected.
- *`useMemo(() => createStyles(t), [t])` per component, no shared cache* —
  identical ergonomics, but rebuilds each sheet once per component instance
  rather than once per mode. The shared cache costs six lines. Rejected in
  favour of the cache.

**[ASSUMPTION: `makeStyles` lives in the mobile app (`src/lib/theme.tsx`), not
in `@tech-office/theme-tokens`. The token package is deliberately
platform-agnostic — it has no React and no React Native import today, and web
consumes it through MUI's `createTheme`. Putting a React Native hook in it would
make the web bundle depend on a React Native peer.]**

---

## R2 — How do native controls follow the app's theme without pinning the OS?

This is the subtle one, and getting it wrong breaks FR-011.

`Appearance.setColorScheme(x)` is what makes keyboards, text carets, `Switch`
tracks, native pickers, selection handles, and scroll indicators match
(FR-005). But it also **overrides what `Appearance.getColorScheme()` and the
`Appearance` change listener report** — after calling it, the app can no longer
observe the phone's own setting through `Appearance`, and a naive listener
hears its own writes.

**Decision**: Drive `Appearance.setColorScheme` from the *preference source*,
not from the resolved mode:

| `preference_source` | Call | Effect |
|---|---|---|
| `os_default` | `Appearance.setColorScheme(null)` | The app follows the phone. `getColorScheme()` and the change listener report the phone's real setting, so an OS change fires the listener and we update state and re-write `(newMode, 'os_default')` — FR-011. Native controls follow the phone, which *is* the active theme. |
| `manual` | `Appearance.setColorScheme(chosenMode)` | Native controls match the deliberate choice. OS changes are correctly invisible — FR-012 falls out of the mechanism instead of needing a guard. |
| signed out | `Appearance.setColorScheme(null)` | Follows the phone — FR-014. |

**Rationale**: The two states the spec distinguishes are exactly the two states
the platform API distinguishes. `null` means "follow the OS" in both. No
feedback-loop guard, no shadow copy of the OS scheme, no per-control theming
props scattered across the codebase.

**Alternatives considered**:

- *Never call `setColorScheme`; theme each native control by prop*
  (`keyboardAppearance` on every `TextInput`, `themeVariant` on pickers,
  `trackColor`/`thumbColor` on every `Switch`, `indicatorStyle` on every
  `ScrollView`). Keeps `Appearance` observable but adds a prop to hundreds of
  elements and silently regresses the moment someone adds a `TextInput` without
  it. Rejected — it is more code and a worse invariant.
- *Always `setColorScheme(resolvedMode)` and keep a separate `osScheme` state
  captured before the first override*. Requires the app to guess whether a
  listener callback is its own write or a real OS change, and cannot detect an
  OS change that happens while the app is backgrounded and pinned. Rejected as
  incorrect, not merely ugly.

The existing `ThemeAdapter` in `src/lib/platform-adapter.ts` needs no change:
under `setColorScheme(null)` it reports the phone's setting, which is what
`detectOSTheme()` is for.

---

## R3 — Where does the theme decision live, and how is it tested?

**Decision**: A pure resolution function in
`frontend/apps/mobile/src/lib/theme-resolution.ts`, with an assertion-based
self-check at `theme-resolution.check.ts` wired to a
`pnpm check:theme-resolution` script — the same pattern the repo already uses
for `channel-voice-call-state.check.ts`, `doc-rows.check.ts`, and
`device-timezone.check.ts`.

```ts
resolveTheme({ signedIn, serverPreference, cachedTheme, osScheme }): {
  mode: 'light' | 'dark';
  source: 'manual' | 'os_default';
  followOS: boolean;          // → Appearance.setColorScheme(null)
  writeBack: { mode, source } | null;  // → updateUserPreference(...)
}
```

Every requirement from FR-009 to FR-018 is a row in that function's truth table,
including FR-018 (an unrecognised stored value is treated as *no preference*,
not as light — note `apis.getUserPreference` currently coerces unknown proto
enum values to `'light'`, so the resolver keys off `exists` and the
`preferenceSource`, and treats an unparseable mode as absent).

**Rationale**: The interesting behaviour of this feature is a decision table, not
a rendering. A pure function makes FR-009…FR-018 checkable in milliseconds
without a simulator, which is the only way SC-006 ("across ten consecutive cold
launches the app never shows the other theme") is verifiable at all. Maestro
cannot see a one-frame flash.

**Alternatives considered**:

- *Put the logic in the provider component and cover it only with Maestro.*
  Blackbox flows cannot enumerate eight input combinations, and the constitution
  explicitly says edge cases belong outside Maestro (Principle XIII). Rejected.
- *Put the resolver in `packages/apis` next to `theme-storage.ts`.* Tempting,
  but the web's `ThemeProvider` deliberately behaves differently (it does not
  implement FR-011 — it never re-reads the OS after first run) and changing web
  behaviour is explicitly out of scope. A shared resolver that only one caller
  obeys is a shared resolver in name only. Rejected; revisit if the web is ever
  brought onto the same rules.

---

## R4 — What paints the very first frame?

FR-016 requires the first frame to use the last theme known for that person on
that phone. `loadThemePreference(employeeId)` reads MMKV **synchronously**, but
`employeeId` lives in `expo-secure-store` and is read **asynchronously** during
auth hydration — so at frame zero there is no person to key the lookup by.

**Decision**: On every successful resolution, mirror the resolved mode into a
device-scoped MMKV key `theme_last_known`, and clear it on sign-out. Frame zero
reads that key; once auth hydrates, the per-person key
(`theme_preference_{employeeId}`) governs; once the server answers, it governs.

**Rationale**: Three lines of storage, and it makes the common case — the same
person reopening their own phone — correct on the first frame with no async
wait. Clearing on sign-out is what keeps the spec's "never used for somebody
else" invariant: between sign-out and the next sign-in the app is signed out and
follows the phone anyway (FR-014), so a stale device key can never be shown to a
second person.

**Alternatives considered**:

- *Mirror `employeeId` into MMKV so the per-person key is readable
  synchronously.* Duplicates an identity value into non-secure storage to save
  one indirection. Rejected — more surface, no better outcome.
- *Hold the splash screen until the preference resolves.* Violates FR-017
  ("MUST NOT block on the network") and makes a cold launch on a slow connection
  feel broken. Rejected.
- *Accept a one-frame OS-coloured flash before the cached theme applies.*
  Directly contradicts SC-006. Rejected.

**[ASSUMPTION: the device-scoped key stores only `'light'`/`'dark'` — never the
source or the employee id — so it carries no information about who was signed
in.]**

---

## R5 — Dark values for the mobile semantic colour groups

`getMobilePalette(mode)` currently returns light-only `presence`,
`notificationDomain`, `taskState`, `eventCategory`, and `priority`. FR-003
requires dark values for all five.

**Decision**: Make each group a `{ light, dark }` pair in
`packages/theme-tokens/src/mobile.ts` and have `getMobilePalette(mode)` select.
Dark values are **derived, not re-chosen**, by one rule per role, so the meaning
each colour carries is preserved (spec assumption: "a colour that means
'overdue' in light means 'overdue' in dark"):

| Role in light | Dark derivation |
|---|---|
| Foreground / dot / icon (a 600-level Tailwind-family hue) | Step to the 400-level of the same hue — e.g. `#dc2626` → `#f87171`, `#2563eb` → `#60a5fa`, `#16a34a` → `#4ade80`, `#d97706` → `#fbbf24`. This is exactly the light→dark step `darkPalette` already makes for `error`/`info`/`success`/`warning`, so the two families stay consistent. |
| Background tint (a 50-level wash) | A ~15% alpha wash of the same hue over the dark surface — `rgba(220, 38, 38, 0.15)` for error, etc. This is the rule `statusColors` in `colors.ts` already uses for its dark variants, so we are extending an existing convention rather than inventing one. |
| Text-on-tint (an 800-level hue) | The same 400-level value as the dot, which is what reaches 4.5:1 against a 15% wash on `#1e293b`. |
| Neutral (`#94a3b8`, `#64748b`) | Lift toward the dark palette's own neutrals (`#94a3b8` stays; `#64748b` → `#94a3b8`) rather than darkening. |

Two group-specific notes:

- **`presence.ring`** is `#ffffff` today, sized to separate a dot from an avatar
  photo. In dark it becomes the surface it sits on (`background.paper`), not
  white — a white ring on a dark card is a bright artefact, and the ring's job
  is separation from the *avatar*, not brightness.
- **`shadows`** are `#0f172a` at 4–8% opacity. On a `#0f172a` background they are
  invisible. Rather than invent dark shadows, elevation in dark is carried by
  the existing `border`/`divider`, which is the platform convention on both
  iOS and Android. `shadows` keeps its values; dark surfaces rely on
  `divider` — this is the spec's "a wash computed for a white background is not
  a wash for a dark one" edge case, resolved by dropping the wash rather than
  recomputing it.

**Rationale**: A derivation rule is auditable and produces no surprises; a
hand-picked dark palette for five groups is 30-odd colours of taste that nobody
can review against the light set. Both halves of the rule already exist in the
repo (`darkPalette`'s own steps, and `statusColors.dark`), so this adds a
convention rather than a second one.

**Alternatives considered**: hand-authoring each dark value against a mood
board (unreviewable, and the spec forbids re-mapping meanings); computing dark
values at runtime from the light values by HSL transform (a build-time constant
computed at render time, and the arithmetic result still needs eyeballing, so
it buys nothing over writing the derived constant down).

---

## R6 — Proving WCAG AA across the full token set (SC-002)

**Decision**: A runnable contrast check at
`frontend/packages/theme-tokens/src/contrast.check.ts`, exposed as
`pnpm --filter @tech-office/theme-tokens check:contrast` and folded into
`make test-frontend`. It enumerates every declared foreground/background pairing
in both palettes — `text.*` on `background.*`, each `ColorScale.contrastText` on
its `main`, every semantic group's text/dot/icon on its own `bg` and on
`background.paper`, and `divider` against both backgrounds — computes the WCAG
2.1 relative-luminance ratio, and fails with a table of offending pairs.

Thresholds per FR-007: 4.5:1 body text, 3:1 large text / icons / control
boundaries. Alpha washes (`rgba(...)`) are composited over the surface they are
declared for before the ratio is computed — an uncomposited alpha colour would
score meaninglessly.

**Rationale**: SC-002 says "verified across the full set of tokens rather than
by spot-check", which is a program, not a review activity. The maths is about
forty lines with no dependency; the repo's `*.check.ts` convention already
covers exactly this kind of assertion script.

**Alternatives considered**: an accessibility audit tool over a running app
(cannot enumerate token pairs that no current screen happens to render, and the
spec asks for token coverage); a spreadsheet (not runnable, so it rots).

**[ASSUMPTION: the pairing list is declared explicitly in the check rather than
inferred from screen usage. Inferring from usage would only verify pairs that
exist today and would silently stop covering a token the moment a screen stops
using it.]**

---

## R7 — Keeping raw colours out of mobile screens (FR-002)

**Decision**: An ESLint `no-restricted-syntax` rule in
`frontend/eslint.config.mts`, scoped to `apps/mobile/src/**`, that rejects
string literals matching `^#[0-9a-fA-F]{3,8}$` and `^rgba?\(`. The 50 files that
currently carry hex literals are cleaned as part of the sweep, so the rule lands
green.

**Rationale**: FR-002 is an invariant that has to hold for every file written
after this feature, not a one-time cleanup — and a sweep this large will be
undone within a month by the first screen that reaches for `#fff`. A lint rule
is the cheapest thing that keeps it true, and it matches the project's standing
preference for enforcing a property with a linter rather than adopting the
infrastructure that would require it.

**Alternatives considered**: a review checklist item (does not survive contact
with a hurried PR); a runtime dev-mode warning (fires only on screens someone
happens to open).

**[ASSUMPTION: the rule allows an inline `// eslint-disable-next-line` escape
for the genuinely non-theme colours the spec carves out — the notification tint
`#1F3B73` and the adaptive-icon background `#F2733F` in `app.json` are already
outside `src/`, but any brand constant that must live in `src/` gets a named
export in one file with a comment, rather than a scattered disable.]**

---

## R8 — Navigation chrome, status bar, and the between-screen flash

**Decision**: Theme navigation through explicit `screenOptions`, not through
`@react-navigation/native`'s `ThemeProvider`.

- `src/lib/stack-screen-options.ts` becomes
  `tabRootStackScreenOptions(palette)` — a function, called inside each layout
  with the active palette. It sets `headerTitleStyle.color`, `headerTintColor`
  (back chevron), `headerStyle.backgroundColor` (Android, where the header is
  opaque), `headerBlurEffect` (`'regular'` → `'systemChromeMaterialDark'` in
  dark on iOS), and — new — `contentStyle.backgroundColor`.
- `contentStyle.backgroundColor` is what removes the white flash between screen
  pushes (FR-006, SC-001): without it, `react-native-screens` paints the
  navigator's default background, which is white.
- `src/app/(app)/_layout.tsx` passes palette colours to `tabBarStyle`,
  `tabBarActiveTintColor`, `tabBarInactiveTintColor` (FR-004).
- `src/app/_layout.tsx:225` — `<StatusBar style="dark" />` becomes
  `style={mode === 'dark' ? 'light' : 'dark'}` (FR-004: the phone's clock and
  battery stay visible). `style="auto"` is wrong here, because the app's theme
  may deliberately differ from the phone's.

**Rationale**: `@react-navigation/native` is only a transitive dependency
(v7.1.34, via `expo-router`); making it a direct one to obtain a four-colour
theme object that cannot carry `taskState` or `priority` means two theme sources
of truth. Explicit options are more lines in three layout files and zero new
concepts.

**Alternatives considered**: adding `@react-navigation/native` as a direct
dependency and wrapping in its `ThemeProvider` (two theme systems, and expo-router
owns the container); leaving `contentStyle` unset and accepting the flash
(fails SC-001 and the spec's "no white flash" scenario).

---

## R9 — Splash and launch background (FR-023, US4)

**Decision**: Add a `dark` block to the `expo-splash-screen` config plugin in
`app.json`:

```jsonc
["expo-splash-screen", {
  "image": "./assets/splash-icon.png",
  "imageWidth": 220,
  "resizeMode": "contain",
  "backgroundColor": "#FFFFFF",
  "dark": { "image": "./assets/splash-icon.png", "backgroundColor": "#0f172a" }
}]
```

`userInterfaceStyle` is already `"automatic"` in `app.json`, so no change there.
`#0f172a` is `darkPalette.background.default`; `#FFFFFF` stays as-is so a light
launch is byte-identical (SC-003).

The splash follows the **phone's** setting, not the person's stored theme —
it renders before any JavaScript runs, so the stored preference is
unknowable at that point. That matches FR-023's wording ("MUST follow the phone's
setting") and is the reason US4 is scoped separately from US1.

**Rationale**: One config block, regenerated by `expo prebuild`. It is the only
mechanism that runs before the app's own code.

**Alternatives considered**: a JS-drawn splash after the native one (does not
cover the frame FR-023 is about); a permanently dark splash (fails US4
scenario 2 — light phones must look exactly as they do today).

**[ASSUMPTION: the same `splash-icon.png` is reused for dark. It is a 1024×1024
RGBA image with transparency, so the mark composites correctly on either
background, and per the spec's brand-colour carve-out the mark keeps its fixed
colours in both themes. If review finds the mark unreadable on `#0f172a`, a
dark-specific asset is a one-line change to the `dark.image` path.]**

**[ASSUMPTION: `android.adaptiveIcon.backgroundColor` (`#F2733F`) and the
`expo-notifications` tint (`#1F3B73`) are left alone — the spec's edge case puts
the app icon, the notification tint, and brand marks outside the theme.]**

---

## R10 — Re-reading the preference on foreground and at sign-in (FR-015)

**Decision**: The theme provider holds the preference in React Query under
`["user-preference"]` and calls `refetch()` on two events: `AppState` becoming
`active` (the app already has `src/hooks/use-app-state.ts`), and the auth
context's `employeeId` changing. React Query's cache is already persisted
(`src/lib/query-client.ts` / `setupQueryPersistence`).

**Rationale**: The spec's own assumption rules out a realtime channel for a
change that happens rarely. Foreground refetch is the machinery the app already
uses for everything else that can change on another device.

**Alternatives considered**: an SSE/notification-stream event for preference
changes (the spec explicitly rejects it as out of proportion); polling on an
interval (wakes the radio for a value that changes a few times a year).

---

## R11 — Blackbox coverage (Principle XIII)

**Decision**: One Maestro flow, `.maestro/settings/dark-mode-toggle.yaml`:
sign in → More → Settings → assert the theme control is visible → tap it →
assert a dark-mode-only marker is visible → relaunch → assert it is still
visible. The marker is a `testID` on the settings screen's theme row whose
accessibility label carries the active mode (e.g. `theme-toggle-row` with
`accessibilityValue` `"dark"`), because Maestro is a blackbox driver and cannot
sample a pixel.

Per Principle XIII the flow covers the happy path only; the eight resolution
edge cases live in `theme-resolution.check.ts` (R3) and the contrast sweep lives
in `contrast.check.ts` (R6).

**[ASSUMPTION: the "app is actually dark" assertion is made through an
accessibility value on the theme row rather than a screenshot comparison.
Maestro has no colour assertion, and screenshot baselines across two platforms
and several device sizes are a maintenance burden far larger than the feature.
Visual confirmation across every screen is SC-001, a review activity, which the
spec itself classifies as such.]**

---

## Resolved Technical Context

| Field | Value |
|---|---|
| Language/Version | TypeScript 5.9, React 19.2, React Native 0.83.4, Expo SDK 55 |
| Primary Dependencies | expo-router 55, `@tech-office/theme-tokens` (workspace), `apis` (workspace), `@tanstack/react-query` 5.90, `react-native-mmkv` 3.2, `expo-status-bar`, `expo-splash-screen` — **no new dependency** |
| Storage | MMKV via the existing platform adapter (`theme_preference_{employeeId}`, plus device-scoped `theme_last_known`); server-side `iam.user_preference` unchanged |
| Testing | `theme-resolution.check.ts` + `contrast.check.ts` (node `--experimental-strip-types`, repo convention); one Maestro flow `settings/dark-mode-toggle.yaml`; `tsc --noEmit`; ESLint |
| Target Platform | iOS 16.4+ and Android — both verified, per the standing rule that mobile UI must be checked on Android as well as iOS |
| Project Type | Mobile app in a pnpm monorepo (`frontend/apps/mobile`) + shared token package |
| Performance Goals | Theme switch repaints in <1s (SC-005); each stylesheet built at most twice per process; no added per-render allocation |
| Constraints | No backend change; no new runtime dependency; light-mode output byte-identical to today (SC-003); first frame must not flash (SC-006); must not block on the network at launch (FR-017) |
| Scale/Scope | 98 mobile files + 3 token-package files + `app.json` + `eslint.config.mts` + 1 Maestro flow |
