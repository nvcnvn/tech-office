/**
 * Which theme the app paints, as a pure function.
 *
 * The interesting behaviour of mobile dark mode is a decision table, not a
 * rendering: five inputs (is anyone signed in, what has the server stored, what
 * did this person last see on this phone, what did *anyone* last see on this
 * phone, what is the phone set to) collapse into one mode, one preference
 * source, and at most two writes. Keeping that table here — with no React, no
 * storage, and no network — is what lets `theme-resolution.check.ts` walk every
 * row in milliseconds. The requirement it exists for, "never shows the other
 * theme, not even for a frame", is not something a blackbox driver can see.
 */

import type { PreferenceSource, ThemeMode, UserPreference } from "apis";

export interface ThemeResolutionInput {
  /** Whether a person is signed in. A signed-out app has no stored choice to obey. */
  signedIn: boolean;
  /** What the phone itself is set to, right now. */
  osScheme: ThemeMode;
  /** `theme_preference_{employeeId}` — this person's last theme on this phone. */
  cachedTheme: ThemeMode | null;
  /** `theme_last_known` — the last theme anyone saw on this phone, readable at frame zero. */
  deviceLastKnown: ThemeMode | null;
  /** `null` means the server has not answered yet, or could not be reached. */
  serverPreference: UserPreference | null;
}

export interface ThemeResolutionOutput {
  mode: ThemeMode;
  source: PreferenceSource;
  /** Mirrored into `Appearance.setColorScheme(followsOS ? null : mode)`. */
  followsOS: boolean;
  /** A fire-and-forget `updateUserPreference` call, or null. Never writes `'manual'`. */
  writeBack: { mode: ThemeMode; source: PreferenceSource } | null;
  /** The mode to mirror into both local caches, or null while the answer is provisional. */
  cacheWrite: ThemeMode | null;
}

/**
 * Resolves the theme from the seven-row table in data-model.md §5. The first row
 * that matches wins.
 *
 * Two rules are load-bearing and easy to lose in a refactor:
 *
 * - Presence of a stored preference is keyed off `exists`, never off `themeMode`.
 *   `getUserPreference` coerces a proto enum value it does not recognise to
 *   `'light'`, so a mode the app cannot read would otherwise pin a person to
 *   light forever instead of following their phone (FR-018).
 * - Every pre-answer row reports `source: 'os_default'`. A cached value is the
 *   last thing this phone painted, not evidence that anybody chose it, and
 *   reporting it as `'manual'` would make the app stop following the phone on the
 *   strength of its own cache (FR-013).
 *
 * `followsOS` is therefore always `source === 'os_default'`, which is not a
 * redundancy worth collapsing — it is the invariant that keeps `Appearance`
 * observable. The provider mirrors it into
 * `Appearance.setColorScheme(followsOS ? null : mode)`, and `setColorScheme` also
 * overrides what `Appearance` *reports*. Pinning during the provisional rows 5
 * and 6 — when the painted theme is a cache and may differ from the phone —
 * would make the app read its own cached value back as the phone's setting, and
 * a person whose phone is light but whose cache is dark would be written back to
 * the server as `(dark, 'os_default')` and never follow their phone again. So
 * the only state that pins is a deliberate choice, where ignoring the phone is
 * the point (FR-012). The cost is that for the few hundred milliseconds before
 * the server answers, the keyboard may not match a cached theme; the alternative
 * is corrupting the input the whole table is keyed on.
 */
export function resolveTheme(input: ThemeResolutionInput): ThemeResolutionOutput {
  const { signedIn, osScheme, cachedTheme, deviceLastKnown, serverPreference } = input;

  // Row 1 — signed out. There is no person whose deliberate choice could apply,
  // so the phone decides and nothing is written anywhere (FR-014).
  if (!signedIn) {
    return {
      mode: osScheme,
      source: "os_default",
      followsOS: true,
      writeBack: null,
      cacheWrite: null,
    };
  }

  if (serverPreference !== null && serverPreference.exists) {
    // Row 2 — a deliberate choice. The phone's setting is ignored from here
    // (FR-009, FR-012).
    if (serverPreference.preferenceSource === "manual") {
      return {
        mode: serverPreference.themeMode,
        source: "manual",
        followsOS: false,
        writeBack: null,
        cacheWrite: serverPreference.themeMode,
      };
    }

    // Row 3 — a stored row that only ever mirrored the phone. Keep mirroring it,
    // and re-record it when the phone has moved since (FR-011). The write is
    // skipped when nothing changed, so a foreground refetch is not a write.
    return {
      mode: osScheme,
      source: "os_default",
      followsOS: true,
      writeBack:
        serverPreference.themeMode === osScheme
          ? null
          : { mode: osScheme, source: "os_default" },
      cacheWrite: osScheme,
    };
  }

  // Row 4 — the server answered and there is no row. Adopt the phone's setting
  // and record that it was adopted rather than chosen (FR-010, FR-013).
  if (serverPreference !== null) {
    return {
      mode: osScheme,
      source: "os_default",
      followsOS: true,
      writeBack: { mode: osScheme, source: "os_default" },
      cacheWrite: osScheme,
    };
  }

  // Rows 5–7 — the server has not answered. Everything below is provisional: it
  // paints, it never writes, and it is superseded the moment the answer arrives.

  // Row 5 — this person's last theme on this phone (FR-016).
  if (cachedTheme !== null) {
    return {
      mode: cachedTheme,
      source: "os_default",
      followsOS: true,
      writeBack: null,
      cacheWrite: null,
    };
  }

  // Row 6 — frame zero, before `employeeId` has come back from SecureStore. The
  // device-scoped key is the only theme readable synchronously at that point.
  if (deviceLastKnown !== null) {
    return {
      mode: deviceLastKnown,
      source: "os_default",
      followsOS: true,
      writeBack: null,
      cacheWrite: null,
    };
  }

  // Row 7 — nothing known at all: a first launch, or a signed-in person on a
  // phone that has never painted. Follow the phone rather than block (FR-017).
  return {
    mode: osScheme,
    source: "os_default",
    followsOS: true,
    writeBack: null,
    cacheWrite: null,
  };
}
