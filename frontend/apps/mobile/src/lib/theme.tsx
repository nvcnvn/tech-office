/**
 * The mobile theme runtime: one palette, resolved at render time.
 *
 * Before this existed, 98 modules called `StyleSheet.create({...lightPalette...})`
 * at *import* time, which is why the app was a light-mode app no matter what the
 * phone or the person's stored preference said. `makeStyles` is the smallest
 * change that moves that decision to render time without a new dependency and
 * without rewriting how any of those sheets are spelled.
 *
 * See specs/050-mobile-dark-mode/contracts/theme-runtime.md for the contract the
 * swept files are written against.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Appearance,
  StyleSheet,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMobilePalette, type MobilePalette } from "@tech-office/theme-tokens";
import {
  clearThemePreference,
  getUserPreference,
  loadThemePreference,
  saveThemePreference,
  updateUserPreference,
  type PreferenceSource,
  type ThemeMode,
  type UserPreference,
} from "apis";

import { useAuth } from "@/hooks/use-auth";
import { useAppState } from "@/hooks/use-app-state";
import { deviceStorage } from "./platform-adapter";
import { resolveTheme } from "./theme-resolution";

/** React Query key for the stored preference. Refetched on foreground and at sign-in. */
const PREFERENCE_QUERY_KEY = ["user-preference"] as const;

// ── Context ─────────────────────────────────────────────────────────────────

export interface ThemeState {
  /** The active theme. Never null and never "loading" — a component can always paint. */
  mode: ThemeMode;
  /** `getMobilePalette(mode)` by identity, so it is safe as a `useMemo` dependency. */
  palette: MobilePalette;
  /** Where the active theme came from. Governs whether the phone is followed. */
  source: PreferenceSource;
  /** Mirrored into `Appearance.setColorScheme(followsOS ? 'unspecified' : mode)`. */
  followsOS: boolean;
  /** True from launch until the server has answered or failed. Never blocks render. */
  settling: boolean;
  /** Records a deliberate choice. The only exported path that may write `'manual'`. */
  setMode(mode: ThemeMode): Promise<void>;
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * The active theme.
 *
 * Throws outside `<ThemeProvider>`, matching the web `useTheme`. A silent
 * fallback here would be a screen that paints light inside a dark app and looks
 * like a styling bug rather than a missing provider.
 */
export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}

// ── makeStyles ──────────────────────────────────────────────────────────────

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Turns a module-level stylesheet into a hook that reads the active palette.
 *
 * ```ts
 * const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.background.paper } }));
 * // inside the component:
 * const styles = useStyles();
 * ```
 *
 * Each sheet is built at most twice for the life of the process — once per mode,
 * from a two-entry cache — so this costs the same as the import-time
 * `StyleSheet.create` it replaces and adds no per-render allocation. The returned
 * object is referentially stable per mode, which is what keeps it usable as a
 * dependency and keeps `React.memo` children from re-rendering.
 *
 * The returned value is a hook and obeys the rules of hooks. Anything that needs
 * a palette *outside* a component — navigation `screenOptions`, most of all —
 * takes the palette as a plain argument instead; see `stack-screen-options.ts`.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  fn: (t: MobilePalette) => T
): () => T {
  const cache = new Map<ThemeMode, T>();

  return function useStyles(): T {
    const { mode, palette } = useTheme();
    let sheet = cache.get(mode);
    if (sheet === undefined) {
      sheet = StyleSheet.create(fn(palette));
      cache.set(mode, sheet);
    }
    return sheet;
  };
}

// ── The phone's own setting ─────────────────────────────────────────────────

/**
 * Reads `'light'` or `'dark'` out of an `Appearance` API that can report neither.
 *
 * `getColorScheme()` returns `null` before the native module has answered and
 * `'unspecified'` in the moment after the app hands the override back to the OS —
 * neither of which is a theme. Both mean "no answer yet", and the right response
 * is to keep the last real answer rather than fall back to light: falling back
 * would repaint a dark phone light for a frame and, on an `os_default` row, write
 * that fallback to the server as though the phone had moved.
 */
function readOSColorScheme(): ThemeMode | null {
  const reported = Appearance.getColorScheme();
  return reported === "dark" || reported === "light" ? reported : null;
}

// ── The last theme this phone painted ───────────────────────────────────────

/**
 * A device-scoped key, deliberately separate from the per-person
 * `theme_preference_{employeeId}`.
 *
 * At frame zero there is no person to key a lookup by: `employeeId` lives in
 * SecureStore and arrives asynchronously, while MMKV reads synchronously. This
 * key is the only theme readable in time to paint the first frame, so it holds
 * `'light'` or `'dark'` and nothing else — no source, no identity — and it is
 * cleared on sign-out so a remembered theme is never shown to a second person.
 */
const DEVICE_THEME_KEY = "theme_last_known";

function readDeviceLastKnown(): ThemeMode | null {
  const stored = deviceStorage.getItem(DEVICE_THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function writeDeviceLastKnown(mode: ThemeMode): void {
  deviceStorage.setItem(DEVICE_THEME_KEY, mode);
}

function clearDeviceLastKnown(): void {
  deviceStorage.removeItem(DEVICE_THEME_KEY);
}

// ── Provider ────────────────────────────────────────────────────────────────

/**
 * Resolves the theme for the whole app.
 *
 * Mounted inside `QueryClientProvider` and above every screen, including the
 * signed-out ones — a person on the sign-in screen has a phone with a setting,
 * even though they have no stored preference yet (FR-014).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, employeeId } = useAuth();
  const queryClient = useQueryClient();
  const [osScheme, setOSScheme] = useState<ThemeMode>(() => readOSColorScheme() ?? "light");

  // Whether the app has pinned the native colour scheme to a deliberate choice.
  // A ref, not state, because the `Appearance` listener below is registered once
  // and has to read the *current* value from inside a closure it never rebuilds.
  const pinned = useRef(false);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      // While pinned, this event is the app hearing its own override come back.
      // Taking it would overwrite the phone's setting with the person's choice,
      // and the app would stop following the phone for good the moment anyone
      // ever chose a theme.
      if (pinned.current) return;
      if (colorScheme === "dark" || colorScheme === "light") {
        setOSScheme(colorScheme);
      }
    });
    return () => subscription.remove();
  }, []);

  // The stored preference. `enabled` keeps it from firing while signed out, and a
  // failure is logged rather than surfaced: the app must start on a phone that
  // cannot reach the server, painting the last theme it knows (FR-017, SC-008).
  const preference = useQuery<UserPreference>({
    queryKey: PREFERENCE_QUERY_KEY,
    queryFn: getUserPreference,
    enabled: isAuthenticated,
    // The theme is not a value worth retrying hard for; the next foreground will
    // ask again anyway, and until then the cache paints.
    retry: 1,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (preference.error) {
      console.warn("[theme] could not read the stored preference:", preference.error);
    }
  }, [preference.error]);

  // Read synchronously, so it is available on the render that needs it rather
  // than one render later. MMKV is a synchronous store; this is not a network call.
  const cachedTheme = employeeId ? loadThemePreference(employeeId) : null;
  const deviceLastKnown = readDeviceLastKnown();

  const resolved = useMemo(
    () =>
      resolveTheme({
        signedIn: isAuthenticated,
        osScheme,
        cachedTheme,
        deviceLastKnown,
        serverPreference: preference.data ?? null,
      }),
    [isAuthenticated, osScheme, cachedTheme, deviceLastKnown, preference.data]
  );

  // `setColorScheme` is what makes the keyboard, text carets, selection handles,
  // native pickers, Switch tracks, and scroll indicators match the app (FR-005).
  // It is driven by whether the theme is a *deliberate choice*, never by the mode
  // itself, because it also overrides what `Appearance` reports back: handing the
  // override away is what keeps the phone observable while the theme follows it
  // (FR-011), and pinning is what makes an OS change correctly invisible once
  // somebody has chosen (FR-012).
  //
  // `'unspecified'` — not `null` — is React Native's value for "follow the OS".
  // `ColorSchemeName` is `'light' | 'dark' | 'unspecified'`; on Android it maps to
  // `MODE_NIGHT_FOLLOW_SYSTEM`, on iOS to `UIUserInterfaceStyleUnspecified`.
  useEffect(() => {
    pinned.current = !resolved.followsOS;
    Appearance.setColorScheme(resolved.followsOS ? "unspecified" : resolved.mode);
  }, [resolved.followsOS, resolved.mode]);

  // Mirror each resolved mode into both local caches, so the next launch paints
  // it before the server has answered (FR-016).
  const { cacheWrite } = resolved;
  useEffect(() => {
    if (cacheWrite === null) return;
    writeDeviceLastKnown(cacheWrite);
    if (employeeId) {
      saveThemePreference(employeeId, cacheWrite);
    }
  }, [cacheWrite, employeeId]);

  // A change made on the web should show up here without a restart, and the
  // preference belongs to whoever is signed in — so it is re-read on foreground
  // and whenever the person changes (FR-015).
  const { refetch } = preference;
  const [foreground, setForeground] = useState(0);
  useAppState(
    useCallback(
      (state) => {
        if (state === "active" && isAuthenticated) {
          setForeground((n) => n + 1);
          void refetch();
        }
      },
      [isAuthenticated, refetch]
    )
  );

  // Adopting the phone's setting for somebody who has never chosen, and
  // re-recording it when the phone moves while the stored row is `os_default`.
  // Fire-and-forget by design: the theme is already painted, so a failure is
  // logged and nothing is surfaced (FR-017).
  //
  // The retry is keyed on the foreground counter rather than on the query's own
  // `dataUpdatedAt`, and that is the whole reason the counter exists. This effect
  // writes its result back into the query cache on success, which would bump
  // `dataUpdatedAt` and re-run the effect — and if a write ever failed to change
  // what the server reports, that is an unbounded loop of network calls. A
  // counter only the app's own foregrounding moves cannot close that circle:
  // at worst the write is attempted once per time the person opens the app.
  const writeBackMode = resolved.writeBack?.mode ?? null;
  useEffect(() => {
    if (writeBackMode === null) return;
    // `'os_default'` is hard-coded rather than read from `writeBack.source`: this
    // path adopts a setting, it never records a choice, and FR-013 is easier to
    // keep true when the only `'manual'` in this file is in `setMode`.
    void updateUserPreference(writeBackMode, "os_default")
      .then((updated) => queryClient.setQueryData(PREFERENCE_QUERY_KEY, updated))
      .catch((error) => {
        console.warn("[theme] could not record the phone's setting:", error);
      });
  }, [writeBackMode, foreground, queryClient]);

  useEffect(() => {
    if (isAuthenticated) {
      void refetch();
    }
  }, [employeeId, isAuthenticated, refetch]);

  // Signing out must leave nothing behind: between now and the next sign-in the
  // app follows the phone (FR-014), and a theme remembered from the last person
  // is a theme shown to the next one.
  const previousEmployeeId = useRef(employeeId);
  useEffect(() => {
    const previous = previousEmployeeId.current;
    previousEmployeeId.current = employeeId;
    if (previous && !employeeId) {
      clearThemePreference(previous);
      clearDeviceLastKnown();
      queryClient.removeQueries({ queryKey: PREFERENCE_QUERY_KEY });
    }
  }, [employeeId, queryClient]);

  /**
   * Records a deliberate choice. The only path in the app that writes `'manual'`.
   *
   * The cache is updated before the request goes out, so the app repaints on the
   * press rather than on the round trip (FR-021); on failure it is rolled back and
   * the rejection is re-thrown, so the caller can say so and the app is never left
   * showing one theme while the server stores the other (FR-022).
   */
  const setMode = useCallback(
    async (next: ThemeMode): Promise<void> => {
      const previous = queryClient.getQueryData<UserPreference>(PREFERENCE_QUERY_KEY);
      queryClient.setQueryData<UserPreference>(PREFERENCE_QUERY_KEY, {
        themeMode: next,
        preferenceSource: "manual",
        exists: true,
      });

      try {
        const updated = await updateUserPreference(next, "manual");
        queryClient.setQueryData(PREFERENCE_QUERY_KEY, updated);
      } catch (error) {
        queryClient.setQueryData(PREFERENCE_QUERY_KEY, previous);
        throw error;
      }
    },
    [queryClient]
  );

  const value = useMemo<ThemeState>(
    () => ({
      mode: resolved.mode,
      palette: getMobilePalette(resolved.mode),
      source: resolved.source,
      followsOS: resolved.followsOS,
      // Only ever true for a signed-in person whose preference has not come back
      // yet. It never gates a render — the app is already painting the best theme
      // it knows — it only lets the Settings control disable itself for the moment
      // a write is in flight.
      settling: isAuthenticated && preference.isPending,
      setMode,
    }),
    [
      resolved.mode,
      resolved.source,
      resolved.followsOS,
      isAuthenticated,
      preference.isPending,
      setMode,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
