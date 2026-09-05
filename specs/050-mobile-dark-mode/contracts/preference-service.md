# Contract: PreferenceService (consumed, unchanged)

**Feature**: `050-mobile-dark-mode`

This feature adds a second client to an existing service. **No proto field, RPC,
enum value, database column, or constraint changes.** This document states the
contract mobile relies on, so that a later change to `PreferenceService` can see
that mobile now depends on it.

Backend: `backend/internal/preference`. Client wrapper:
`frontend/packages/apis/src/preference.ts`. Domain reference:
`docs/domain/workspace-navigation.md` § "Theme and preferences".

---

## RPCs consumed

| RPC | Used by mobile | For |
|---|---|---|
| `GetUserPreference` | Yes | At launch, on foreground, and on sign-in (FR-009, FR-015) |
| `UpdateUserPreference` | Yes | Adopting the phone's setting (`os_default`) and recording a deliberate choice (`manual`) |
| `ResetUserPreference` | **No** | Mobile offers no "reset to system default"; the RPC stays available and unused, as today |

All three infer employee and organisation from the auth context and take no IDs.
Mobile passes nothing that could cross a tenant boundary.

## Wrapper functions consumed

```ts
getUserPreference(): Promise<UserPreference>
updateUserPreference(mode: ThemeMode, source: PreferenceSource): Promise<UserPreference>
```

```ts
interface UserPreference {
  themeMode: 'light' | 'dark';
  preferenceSource: 'manual' | 'os_default';
  exists: boolean;
}
```

Both already exist and are already exercised by the web app. Per Principle VII
mobile calls them through the `apis` package and never touches
`preferenceClient` directly.

## Storage contract relied upon

- `iam.user_preference.theme_mode IN ('light','dark')` — **no `system` value**.
  "Follow the phone" is expressed by `preference_source = 'os_default'`; this
  feature does not add a third value (spec: Out of Scope).
- `iam.user_preference.preference_source IN ('manual','os_default')`. Mobile
  writes `'manual'` **only** from the Settings control's press handler (FR-013).

## Behaviour mobile relies on

1. `GetUserPreference` returns `exists: false` (not an error) when no row exists
   — this is what row 4 of the resolution table keys off.
2. `UpdateUserPreference` upserts, so the first write for a person needs no
   create/update distinction.
3. Neither RPC has a side effect on any other preference; `additional_preferences`
   is untouched.

## Known client-side behaviour mobile works around

`protoThemeModeToString` in `apis/src/preference.ts` coerces an unrecognised
proto enum value to `'light'`. Mobile therefore treats `exists` — not
`themeMode` — as the signal that a stored preference is present (FR-018), so a
value the app does not understand becomes "no preference" and the app follows
the phone rather than silently pinning to light.

**[ASSUMPTION: this coercion is left as it is rather than changed to return
null. It is shared with the web app, whose behaviour is explicitly out of scope,
and the mobile resolver does not need it changed to satisfy FR-018.]**

## Divergence from the web client, deliberate

The web `ThemeProvider` (`frontend/apps/web/src/components/ThemeProvider.tsx`)
adopts the OS scheme once, on first run, and never re-reads it — so a web
session with `preference_source = 'os_default'` does not follow a later OS
change. Mobile implements FR-011 and does follow it. The two clients therefore
read the same stored contract with different rules.

This is intentional: the spec puts any change to the web app out of scope, and
FR-011 is a mobile requirement. It is recorded here so the difference is a
documented decision rather than a discovery, and it belongs in the drift
register when D30 is closed.
