# Contract: Mobile Theme Runtime

**Feature**: `050-mobile-dark-mode`

The interfaces this feature exposes *inside* the mobile app and the token
package. These are the surfaces 98 mobile modules are rewritten against, so
they are contracts in the same sense a public API is: once the sweep lands, a
change here is a change to every screen.

No HTTP/RPC surface is added. See [preference-service.md](./preference-service.md)
for the existing server contract this feature consumes.

---

## 1. `@tech-office/theme-tokens` — `getMobilePalette(mode)`

**Module**: `frontend/packages/theme-tokens/src/mobile.ts`

```ts
export function getMobilePalette(mode: 'light' | 'dark'): MobilePalette;

type MobilePalette = ThemePalette & {
  presence:           { online: string; away: string; busy: string; offline: string; ring: string; ringWidth: number };
  notificationDomain: Record<'chat'|'tasks'|'calendar'|'system', { bg: string; icon: string }>;
  taskState:          Record<'todo'|'inProgress'|'done'|'cancelled', { dot: string; bg: string; text: string }>;
  eventCategory:      Record<'meeting'|'personal'|'holiday'|'deadline'|'reminder'|'other', string>;
  priority:           Record<'critical'|'high'|'medium'|'low', { bg: string; text: string; dot: string }>;
};
```

**Change from today**: the signature is unchanged; the five semantic groups
become mode-dependent instead of returning light values for both modes (FR-003).

**Guarantees**:

- `getMobilePalette('light')` returns byte-identical values to today, for every
  key. This is what makes SC-003 checkable rather than a matter of opinion.
- Every key present under `light` is present under `dark`, enforced by the
  `{ light, dark }` record types rather than by review.
- Every declared pairing meets WCAG 2.1 AA in both modes, enforced by
  `contrast.check.ts`.

**Breaking**: the previously exported bare constants `presence`,
`notificationDomain`, `taskState`, `eventCategory`, and `priority` are removed
from the package's public surface — they only ever had light values, and leaving
them exported is exactly how a screen would go on painting a light badge on a
dark card. Every consumer goes through `getMobilePalette(mode)`. All consumers
are in this repository and are updated in the same change set.

## 2. `@tech-office/theme-tokens` — contrast check

**Module**: `frontend/packages/theme-tokens/src/contrast.check.ts`

```
pnpm --filter @tech-office/theme-tokens check:contrast
```

Exits non-zero and prints a table of `{ pair, mode, ratio, required }` for any
declared foreground/background pairing below its FR-007 threshold (4.5:1 body
text; 3:1 large text, icons, control boundaries). Alpha colours are composited
over their declared surface before measurement.

## 3. Mobile — `useTheme()`

**Module**: `frontend/apps/mobile/src/lib/theme.tsx`

```ts
export function useTheme(): ThemeState;

interface ThemeState {
  mode: 'light' | 'dark';
  palette: MobilePalette;
  source: 'manual' | 'os_default';
  followsOS: boolean;
  settling: boolean;
  setMode(mode: 'light' | 'dark'): Promise<void>;
}
```

**Guarantees**:

- `mode` and `palette` are never null and never "loading" — a component can
  always paint. This is the structural form of FR-017.
- `palette === getMobilePalette(mode)` by identity, so it is safe as a `useMemo`
  dependency.
- `setMode` records a **deliberate** choice (`preference_source = 'manual'`).
  It is the only exported way to reach `'manual'`, which is how FR-013 is
  enforced rather than remembered.
- `setMode` resolves after the server write settles. It updates `mode`
  synchronously before awaiting (FR-021), and on failure restores the previous
  mode and rejects, so the caller can surface FR-022's message.

**Throws** if called outside `<ThemeProvider>`, matching the web `useTheme`.

## 4. Mobile — `<ThemeProvider>`

**Module**: `frontend/apps/mobile/src/lib/theme.tsx`

```tsx
<ThemeProvider>{children}</ThemeProvider>
```

Mounted in `src/app/_layout.tsx` **outside** `AuthProvider`'s consumers and
inside `QueryClientProvider`, so signed-out screens (`(auth)`, `(onboarding)`,
`booking`, `canonical-link`) get a theme too (FR-014).

Takes no `employeeId` prop — unlike the web provider it reads the auth context
itself, because on mobile the id arrives asynchronously from SecureStore and the
provider must render before it does (R4).

**Obligations**:

| Obligation | Requirement |
|---|---|
| Paints the first frame from `theme_last_known`, then the per-person cache, then the server | FR-016, SC-006 |
| Never blocks render on the network; a fetch failure is logged, not surfaced | FR-017, SC-008 |
| Mirrors `followsOS` into `Appearance.setColorScheme(followsOS ? null : mode)` | FR-005, FR-011, FR-012 |
| Refetches the preference when `AppState` becomes `active` and when `employeeId` changes | FR-015 |
| Clears `theme_preference_{employeeId}` and `theme_last_known` on sign-out | spec edge case: a remembered theme is never shown to a second person |

## 5. Mobile — `makeStyles(fn)`

**Module**: `frontend/apps/mobile/src/lib/theme.tsx`

```ts
export function makeStyles<T extends NamedStyles>(
  fn: (t: MobilePalette) => T
): () => T;
```

Returns a hook. The hook reads the active mode from context and returns
`StyleSheet.create(fn(palette))` from a two-entry cache keyed by mode, so each
sheet is constructed at most twice for the life of the process and the returned
object is referentially stable per mode.

Call-site shape — this is the diff applied to 98 files:

```diff
-const styles = StyleSheet.create({
-  card: { backgroundColor: lightPalette.background.paper, borderColor: lightPalette.divider },
+const useStyles = makeStyles((t) => ({
+  card: { backgroundColor: t.background.paper, borderColor: t.divider },
 }));

 export function Card() {
+  const styles = useStyles();
   return <View style={styles.card} />;
 }
```

**Constraint**: the returned hook obeys the rules of hooks. Modules that today
use their stylesheet outside a component — notably
`src/lib/stack-screen-options.ts` — convert to plain functions of the palette
instead (§6), not to hooks.

## 6. Mobile — `tabRootStackScreenOptions(palette)`

**Module**: `frontend/apps/mobile/src/lib/stack-screen-options.ts`

```ts
export function tabRootStackScreenOptions(t: MobilePalette): NativeStackNavigationOptions;
```

Was a module-level `const` built from `lightPalette`; becomes a function called
inside each layout with the active palette. Beyond re-pointing the existing
`headerTitleStyle.color`, it now also sets `headerTintColor`,
`headerStyle.backgroundColor` (Android, where the header is opaque),
`headerBlurEffect` (`'regular'` in light, `'systemChromeMaterialDark'` in dark
on iOS), and `contentStyle.backgroundColor` — the last being what removes the
white flash between screen pushes (FR-006).

## 7. Mobile — testID contract for the theme control

Per Principle XIII, the Settings theme row is Maestro-targetable and reports the
active mode without a colour assertion:

| testID | Element | Contract |
|---|---|---|
| `theme-toggle-row` | The Settings row | `accessibilityValue={{ text: mode }}` — `"light"` or `"dark"` |
| `theme-toggle-switch` | The `Switch` | On ⇒ dark. Tapping calls `setMode` and repaints before the write settles |

## 8. Lint contract

`frontend/eslint.config.mts` gains a `no-restricted-syntax` entry scoped to
`apps/mobile/src/**` rejecting string literals matching `^#[0-9a-fA-F]{3,8}$`
and `^rgba?\(`. This is the enforcement mechanism for FR-002; without it the
sweep is undone by the first screen that reaches for `#fff`.
