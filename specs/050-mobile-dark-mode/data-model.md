# Phase 1 Data Model: Mobile Dark Mode

**Feature**: `050-mobile-dark-mode` | **Date**: 2026-09-05

**Input**: [spec.md](./spec.md), [research.md](./research.md)

No database table, column, index, or proto message is added, changed, or
removed by this feature. `iam.user_preference` and the three `PreferenceService`
RPCs are consumed exactly as they exist. The entities below are client-side
value types and the one new storage key.

---

## 1. `ThemeMode`

The two themes. Already exported by `apis` and already the domain of
`iam.user_preference.theme_mode`.

```ts
type ThemeMode = 'light' | 'dark';
```

- **No third value.** "Follow the phone" is not a mode; it is
  `preferenceSource === 'os_default'` (spec: Out of Scope).
- **Unrecognised values.** `getUserPreference` coerces an unknown proto enum to
  `'light'`. The resolver therefore never treats a coerced value as
  authoritative on its own — it keys off `exists` (FR-018).

## 2. `PreferenceSource`

Where the current theme came from. Already exported by `apis`; already the
domain of `iam.user_preference.preference_source`.

```ts
type PreferenceSource = 'manual' | 'os_default';
```

| Value | Meaning | Consequences |
|---|---|---|
| `os_default` | The person has never chosen; the value mirrors the phone | The app follows the phone (FR-011); `Appearance.setColorScheme(null)` |
| `manual` | The person chose deliberately | The phone's setting is ignored (FR-012); `Appearance.setColorScheme(mode)` |

**Transitions** (FR-013 — nothing else may write `manual`):

```
(absent) --first launch, adopt phone--> os_default        [FR-010]
os_default --phone setting changes-----> os_default        [FR-011]
os_default --Settings control tapped---> manual            [FR-020]
manual     --phone setting changes-----> manual (no change)[FR-012]
manual     --Settings control tapped---> manual            [FR-020]
```

There is no client-side transition back to `os_default`; the app never calls
`resetUserPreference`. That RPC stays available and unused, as it is today on
mobile.

## 3. `UserPreference` (server-shaped, existing)

Returned by `apis.getUserPreference()` / `updateUserPreference()`. Unchanged.

```ts
interface UserPreference {
  themeMode: ThemeMode;
  preferenceSource: PreferenceSource;
  exists: boolean;   // false ⇒ no row for this person
}
```

## 4. `ThemeState` — the value the app renders from (new)

Held by the mobile theme provider and exposed by `useTheme()`.

| Field | Type | Notes |
|---|---|---|
| `mode` | `ThemeMode` | The active theme. Drives every painted surface. |
| `palette` | `MobilePalette` | `getMobilePalette(mode)` — see §6. |
| `source` | `PreferenceSource` | Governs whether the phone is followed. |
| `followsOS` | `boolean` | `source === 'os_default' && signedIn`, or `!signedIn`. Mirrored into `Appearance.setColorScheme(followsOS ? null : mode)`. |
| `settling` | `boolean` | True from launch until the server has answered or failed. Never blocks render — it exists so the Settings control can disable itself for the moment a write is in flight (FR-021 still repaints optimistically). |
| `setMode(mode)` | `(m) => Promise<void>` | The Settings control's only entry point. Writes `manual`. |

Validation rules:

- `mode` is always one of the two values — there is no null/loading mode, which
  is what makes FR-017 ("MUST NOT fail to start") structurally true.
- `source` is `os_default` whenever `signedIn` is false (FR-014); a signed-out
  app has no person whose deliberate choice could apply.

## 5. `ThemeResolutionInput` / `ThemeResolutionOutput` (new, pure)

The decision table of FR-009…FR-018, isolated in
`src/lib/theme-resolution.ts` so it is checkable without a device.

```ts
interface ThemeResolutionInput {
  signedIn: boolean;
  osScheme: ThemeMode;                    // detectOSTheme()
  cachedTheme: ThemeMode | null;          // loadThemePreference(employeeId)
  deviceLastKnown: ThemeMode | null;      // §7, frame-zero only
  serverPreference: UserPreference | null;// null = not yet / unreachable
}

interface ThemeResolutionOutput {
  mode: ThemeMode;
  source: PreferenceSource;
  followsOS: boolean;
  writeBack: { mode: ThemeMode; source: PreferenceSource } | null;
  cacheWrite: ThemeMode | null;           // per-person + device key
}
```

Resolution order (first row that matches wins):

| # | Condition | `mode` | `source` | `writeBack` | Requirement |
|---|---|---|---|---|---|
| 1 | `!signedIn` | `osScheme` | `os_default` | none | FR-014 |
| 2 | `serverPreference?.exists && source === 'manual'` | server `themeMode` | `manual` | none | FR-009, FR-012 |
| 3 | `serverPreference?.exists && source === 'os_default'` | `osScheme` | `os_default` | `(osScheme,'os_default')` **iff** it differs from the stored value | FR-011 |
| 4 | `serverPreference?.exists === false` (server answered, no row) | `osScheme` | `os_default` | `(osScheme,'os_default')` | FR-010, FR-013 |
| 5 | server not yet answered, `cachedTheme != null` | `cachedTheme` | `os_default` | none | FR-016 |
| 6 | server not yet answered, `deviceLastKnown != null` | `deviceLastKnown` | `os_default` | none | FR-016, R4 |
| 7 | otherwise | `osScheme` | `os_default` | none | FR-017 |

Rows 5–7 are the pre-answer state and are provisional: they never write to the
server, and they are superseded by rows 1–4 the moment the answer arrives. Rows
5 and 6 report `os_default` so a cached value can never masquerade as a
deliberate choice (FR-013).

`writeBack` is fire-and-forget: a failure is logged and retried on the next
foreground, never surfaced (FR-017). This is the one place where the write is
*not* user-initiated; the Settings control's write is (§8).

## 6. `MobilePalette` — the painted surface (extended)

Returned by `getMobilePalette(mode)` in `@tech-office/theme-tokens`. Today it
varies the base `ThemePalette` by mode but returns light-only values for the
five semantic groups. After this feature each group is a `{ light, dark }` pair
selected by mode (FR-003).

| Group | Keys | Dark derivation (R5) |
|---|---|---|
| `presence` | `online`, `away`, `busy`, `offline`, `ring`, `ringWidth` | Dots step to the 400-level hue; `ring` becomes `background.paper`, not white |
| `notificationDomain` | `chat`, `tasks`, `calendar`, `system` → `{ bg, icon }` | `icon` → 400-level; `bg` → 15% alpha wash of the same hue |
| `taskState` | `todo`, `inProgress`, `done`, `cancelled` → `{ dot, bg, text }` | `dot`/`text` → 400-level; `bg` → 15% wash |
| `eventCategory` | `meeting`, `personal`, `holiday`, `deadline`, `reminder`, `other` | → 400-level |
| `priority` | `critical`, `high`, `medium`, `low` → `{ bg, text, dot }` | `dot`/`text` → 400-level; `bg` → 15% wash |

Unchanged and mode-independent, because they are geometry or brand rather than
surface: `touch`, `mobileLayout`, `avatar`, `radius`, `border`, `duration`,
`opacity`, `mobileTypography`, `presence.ringWidth`, and `shadows` (see R5 —
elevation in dark is carried by `divider`, not by a recomputed shadow).

Invariants:

- Every key present in `light` is present in `dark`. Enforced structurally by
  the `{ light, dark }` record type, not by convention.
- Every declared foreground/background pairing meets FR-007 in **both** modes.
  Enforced by `contrast.check.ts` (R6), not by review.

## 7. Local storage keys

| Key | Scope | Written by | Cleared by | Purpose |
|---|---|---|---|---|
| `theme_preference_{employeeId}` | per person | `saveThemePreference` (existing, `apis/theme-storage.ts`) | `clearThemePreference` on sign-out | FR-016 once the person is known |
| `theme_last_known` | per device | the theme provider on each resolution | sign-out | FR-016 at frame zero, before `employeeId` is readable from SecureStore (R4) |

Both live in the MMKV instance the platform adapter already owns
(`new MMKV({ id: "tech-office" })`). `theme_last_known` holds only
`'light'`/`'dark'` — never a source, never an identity.

## 8. Write paths

| Trigger | Call | Source written | Optimistic? |
|---|---|---|---|
| First launch, no stored row | `updateUserPreference(osScheme, 'os_default')` | `os_default` | n/a — nothing visible changes |
| Phone setting changed while `os_default` | `updateUserPreference(newScheme, 'os_default')` | `os_default` | Repaint is immediate; the write follows |
| Settings control tapped | `updateUserPreference(newMode, 'manual')` | `manual` | Yes — repaint first (FR-021), then write; on failure revert both the control and the theme and surface a message (FR-022) |

The distinction that FR-013 protects: only the third row may ever write
`'manual'`, and it is reachable only from a press handler.

## 9. Relationship diagram

```
        Appearance (phone)            PreferenceService (server)
               │                                 │
        detectOSTheme()                  getUserPreference()
               │                                 │
               └──────────┐         ┌────────────┘
                          ▼         ▼
   loadThemePreference ─► resolveTheme(input) ─► ThemeResolutionOutput
   (per person, MMKV)             │                    │
   theme_last_known ──────────────┘                    ├─► ThemeState ─► useTheme()
   (per device, MMKV)                                  │                    │
                                                       ├─► saveThemePreference
                                                       ├─► Appearance.setColorScheme(null | mode)
                                                       └─► updateUserPreference (fire-and-forget)
                                                                            │
                                              makeStyles(fn) ◄──────────────┘
                                                     │
                                            98 mobile modules
```
