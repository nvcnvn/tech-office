# Implementation Plan: Mobile Dark Mode

**Branch**: `050-mobile-dark-mode` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/050-mobile-dark-mode/spec.md`

## Summary

Thread a runtime palette through the mobile app, unpin the colour scheme, and
read the theme preference the person already has. Closes drift **D30**.

Everything this needs exists except the painting: `@tech-office/theme-tokens`
already exports `darkPalette` and `getPalette(mode)`; `apis` already exports
`getUserPreference`, `updateUserPreference`, and the MMKV-backed
`theme-storage` helpers; the mobile platform adapter already wires an
`Appearance`-backed `ThemeAdapter`. What is missing is that **98 mobile files**
build their styles once, at import time, from `lightPalette` chosen by name —
and that `getMobilePalette` returns light-only values for the five semantic
colour groups.

The technical approach, established in [research.md](./research.md):

1. **A local `makeStyles(fn)` factory** (`src/lib/theme.tsx`) that turns each
   module-level `StyleSheet.create({...})` into a hook reading the active
   palette, memoised in a two-entry cache keyed by mode. The per-file diff is a
   colour-for-colour substitution, not a rewrite, and no new dependency is
   added. **(R1)**
2. **`Appearance.setColorScheme` driven by `preference_source`, not by mode** —
   `null` when the theme follows the phone, the explicit mode when the person
   chose deliberately. This is the one subtle decision in the feature: it gives
   FR-005 (native controls match), FR-011 (follow the phone while `os_default`),
   and FR-012 (ignore the phone once `manual`) from a single mechanism, because
   `setColorScheme` also overrides what `Appearance` reports back. **(R2)**
3. **A pure `resolveTheme()`** (`src/lib/theme-resolution.ts`) holding the
   FR-009…FR-018 decision table, with an assertion self-check — the repo's
   existing `*.check.ts` convention — because SC-006 ("never shows the other
   theme, not even for a frame") is not observable to a blackbox driver. **(R3)**
4. **Dark values for the five semantic groups**, derived by rule rather than
   re-chosen, extending conventions already present in `darkPalette` and
   `statusColors.dark`. **(R5)**
5. **Two runnable guards**: a WCAG sweep over every declared token pairing
   (SC-002) and an ESLint rule keeping raw colours out of `apps/mobile/src`
   (FR-002). **(R6, R7)**

No backend, proto, migration, or web change. The `apis` and `PreferenceService`
contracts are consumed exactly as they stand.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.2, React Native 0.83.4, Expo SDK 55

**Primary Dependencies**: `expo-router` 55, `@tech-office/theme-tokens`
(workspace), `apis` (workspace), `@tanstack/react-query` 5.90,
`react-native-mmkv` 3.2, `expo-status-bar`, `expo-splash-screen` —
**no new dependency is added**

**Storage**: MMKV via the existing platform adapter —
`theme_preference_{employeeId}` (existing key, existing helpers) and a new
device-scoped `theme_last_known` for the first frame. Server-side
`iam.user_preference` unchanged.

**Testing**: `theme-resolution.check.ts` and `contrast.check.ts` (node
`--experimental-strip-types`, matching `channel-voice-call-state.check.ts` /
`doc-rows.check.ts` / `device-timezone.check.ts`); one Maestro flow
`.maestro/settings/dark-mode-toggle.yaml`; `pnpm typecheck:mobile`; `pnpm lint`

**Target Platform**: iOS 16.4+ and Android — both verified, per the standing
rule that mobile UI is checked on Android as well as iOS. The habitual test
device is an iPhone SE, so narrow-screen and iOS-only-prop regressions need
deliberate Android checking.

**Project Type**: Mobile app in a pnpm monorepo (`frontend/apps/mobile`) plus the
shared token package (`frontend/packages/theme-tokens`)

**Performance Goals**: A theme change repaints in under one second (SC-005);
each stylesheet is constructed at most twice for the life of the process; no
added per-render allocation versus today's import-time sheets

**Constraints**: Light-mode output byte-identical to today (SC-003); the first
frame must not flash the other theme (SC-006); launch must not block on the
network (FR-017); no backend change; no new runtime dependency

**Scale/Scope**: 98 mobile source files, 3 token-package files, `app.json`,
`eslint.config.mts`, 1 Maestro flow, 2 domain documents

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution v5.20.0.

| # | Principle | Verdict | Basis |
|---|---|---|---|
| I | Data Governance & Multi-Tenancy | **PASS (N/A)** | No new data access. The three `PreferenceService` RPCs infer employee and organisation from the auth context and take no IDs, so mobile cannot pass anything that crosses a tenant boundary. No query, table, or `organization_id` filter changes. |
| II | Scenario-First Integration & E2E Testing | **PASS with justification** | No backend behaviour changes, so there is no new backend scenario to contract. No web surface changes, so no new Playwright spec. Coverage is Principle XIII's Maestro flow plus the two `*.check.ts` guards. The spec's own assumption states this: "at least one blackbox flow per feature domain… exhaustive per-screen visual verification is a review activity, not a flow." Recorded in Complexity Tracking. |
| III | Two-Layer Service Architecture | **PASS (N/A)** | No Go code. |
| IV | Cross-Domain Integration | **PASS (N/A)** | No cross-domain call added or changed. |
| V | Observability, Simplicity & YAGNI | **PASS** | Zero new dependencies; the styling mechanism is six lines of cache over `StyleSheet.create`. NativeWind and react-native-unistyles were both evaluated and rejected as disproportionate (R1). Failures in the fire-and-forget preference write are logged, not surfaced (FR-017). |
| VI | Versioning & Breaking Changes | **PASS** | `getMobilePalette` keeps its signature, but the bare `presence` / `notificationDomain` / `taskState` / `eventCategory` / `priority` exports are **removed** from `theme-tokens` — they only ever had light values, and leaving them exported is exactly how a screen goes on painting a light badge on a dark card. Every consumer is in this repository and is updated in the same change set, which is how this project satisfies VI. |
| VII | Frontend API Wrapper Pattern & Type Safety | **PASS** | All server access goes through `apis` (`getUserPreference`, `updateUserPreference`); `preferenceClient` is never touched directly. The theme control carries a `testID`, per the mobile parallel of the `data-testid` rule. |
| VIII | Cross-Stack Constant Sync — No Value Literals | **PASS, and advanced** | This principle is the reason FR-002 exists. 50 mobile files currently carry raw hex literals; the sweep replaces them with tokens, and an ESLint `no-restricted-syntax` rule scoped to `apps/mobile/src/**` keeps them out (R7). The rule is the enforcement mechanism, not a checklist item. |
| IX | UUID v7 & Nullable Cursor Params | **PASS (N/A)** | No identifiers or pagination. |
| X | Structured Error Details | **PASS** | The only user-visible error path is FR-022 (the write failed). It surfaces through the existing `apis` error handling; no new error detail type. |
| XI | Distributed-First Architecture | **PASS (N/A)** | No server-side state, no in-memory coordination. The preference is already per-user rows read through the existing service. |
| XII | Living Documentation | **PASS, required** | `docs/domain/workspace-navigation.md` § "Theme and preferences" must be rewritten (it currently states "Only the web app participates") and **D30 removed** from the drift register in `docs/domain/README.md` — SC-009 makes this part of the feature, not a follow-up. `backend/docs/` needs no change: no architecture moves. |
| XIII | Mobile Design & Testing — Expo + Maestro | **PASS** | In scope: this is not a new capability but the correct rendering of every existing employee-facing screen, plus one Settings control. No new administrative surface, so the four-capability carve-out is untouched. No layout, spacing, hierarchy, or copy changes (spec: Out of Scope) — tap targets and navigation model are unchanged by construction. One Maestro flow added; `testID` and accessibility value on the theme row. |

**Gate result: PASS.** One justification recorded below.

### Post-Phase-1 re-check

Re-evaluated against the Phase 1 artifacts ([data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)):

- The design added **no** new dependency, service, table, RPC, or abstraction
  beyond `makeStyles`, `resolveTheme`, and one MMKV key. Principle V holds.
- Principle VI's breaking change (the removed bare token exports) is captured
  explicitly in [contracts/theme-runtime.md §1](./contracts/theme-runtime.md).
- Principle VIII's enforcement is captured as a contract
  ([theme-runtime.md §8](./contracts/theme-runtime.md)), not an intention.
- Principle XII's obligation is a checkbox in
  [quickstart.md's Definition of Done](./quickstart.md), including recording the
  deliberate web/mobile divergence on FR-011 in the drift register when D30 is
  removed.
- One new fact surfaced during design and is worth flagging to review: the web
  client does **not** implement FR-011 (it adopts the OS scheme once and never
  re-reads it), so after this feature the two clients read the same stored
  contract under different rules. Changing the web is explicitly out of scope,
  so this is documented as a decision in
  [contracts/preference-service.md](./contracts/preference-service.md) rather
  than silently absorbed.

**Gate result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/050-mobile-dark-mode/
├── plan.md                          # This file
├── spec.md                          # Feature specification
├── research.md                      # Phase 0 output — R1…R11, resolved context
├── data-model.md                    # Phase 1 output — entities, resolution table, storage keys
├── quickstart.md                    # Phase 1 output — six levels of validation
├── contracts/
│   ├── theme-runtime.md             # Provider, useTheme, makeStyles, token exports, lint rule
│   └── preference-service.md        # The existing RPC contract, as consumed
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/
├── packages/theme-tokens/src/
│   ├── colors.ts                    # unchanged (lightPalette, darkPalette, getPalette, statusColors)
│   ├── mobile.ts                    # MODIFIED — five semantic groups become { light, dark };
│   │                                #   getMobilePalette selects; bare exports removed
│   ├── contrast.check.ts            # NEW — WCAG AA sweep over every declared pairing (SC-002)
│   └── index.ts                     # MODIFIED — export surface follows mobile.ts
│
├── apps/mobile/
│   ├── app.json                     # MODIFIED — expo-splash-screen gains a `dark` block (FR-023)
│   ├── package.json                 # MODIFIED — check:theme-resolution script
│   ├── .maestro/settings/
│   │   └── dark-mode-toggle.yaml    # NEW — the one blackbox flow (Principle XIII)
│   └── src/
│       ├── lib/
│       │   ├── theme.tsx            # NEW — ThemeProvider, useTheme, makeStyles
│       │   ├── theme-resolution.ts  # NEW — pure resolveTheme(), the FR-009…FR-018 table
│       │   ├── theme-resolution.check.ts  # NEW — assertion self-check
│       │   ├── stack-screen-options.ts    # MODIFIED — const → function of the palette
│       │   └── platform-adapter.ts        # unchanged — ThemeAdapter already correct
│       ├── app/
│       │   ├── _layout.tsx          # MODIFIED — drop Appearance.setColorScheme("light");
│       │   │                        #   mount ThemeProvider; StatusBar follows the mode
│       │   ├── (app)/_layout.tsx    # MODIFIED — themed tab bar (FR-004)
│       │   ├── (app)/(more)/settings.tsx  # MODIFIED — the switch returns; tombstone removed
│       │   └── …                    # 36 (app) + 8 (auth) + 4 (shared) + 2 (onboarding) + 2 single files
│       └── components/              # 14 ui + 10 chat + 4 rituals + 4 compliance + 4 common
│                                    #   + 2 voice + 2 review + 4 single files
│
└── eslint.config.mts                # MODIFIED — no raw colours in apps/mobile/src (FR-002)

docs/domain/
├── workspace-navigation.md          # MODIFIED — "Only the web app participates" is no longer true
└── README.md                        # MODIFIED — D30 removed from the drift register (SC-009)
```

**Structure Decision**: This is the existing Option 3 shape — a mobile app plus
shared packages inside the `frontend/` pnpm workspace, against an unchanged Go
backend. No new project, package, or directory is introduced; the two new mobile
modules sit in `src/lib/` alongside the other cross-cutting helpers, and the two
check scripts follow the `*.check.ts` convention already used four times in this
repository.

The **98 modified mobile files** are the bulk of the work and are mechanical:
each is a substitution of `lightPalette.X` for `t.X` inside a `makeStyles`
callback, plus one `const styles = useStyles()` line. They are listed by area in
[research.md](./research.md) so `/speckit-tasks` can slice them into reviewable
batches. Per the spec's own assumption, the sweep is the unit of work — there is
no shippable intermediate state, because a half-themed app (a dark tab bar under
a white screen) is worse than a light-only one.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Principle II: no backend integration test and no Playwright E2E spec for a user-facing feature | The feature changes no backend behaviour and no web surface. The `PreferenceService` RPCs, the `iam.user_preference` schema, and the web client are all consumed or left exactly as they are. There is no server-side scenario to contract and no web journey to drive. | Writing a backend integration test would assert behaviour spec 013 already covers and this feature does not touch — a test that passes before the first line is written. A Playwright spec would exercise the web toggle, which is explicitly out of scope. Coverage is instead: `theme-resolution.check.ts` for the eight resolution rules (which no E2E driver could enumerate), `contrast.check.ts` for SC-002 across the full token set, and one Maestro flow for the happy path, per Principle XIII. |
| A 98-file change set in a single feature | The spec's assumption is explicit: "A half-themed app is worse than a light-only one… There is no shippable intermediate state, so the sweep is the unit of work." A person seeing a dark tab bar under a white screen concludes the app is broken. | Screen-by-screen delivery was considered and rejected in the spec itself. The risk is mitigated three ways rather than by splitting the change: the per-file diff is a mechanical substitution with no logic change, `getMobilePalette('light')` is byte-identical to today so SC-003 is a real regression gate, and the ESLint rule prevents the sweep from being quietly undone afterwards. |
