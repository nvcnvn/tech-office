/**
 * Self-check for the theme resolution table. Run with
 * `npm run check:theme-resolution`.
 *
 * The failure this guards is a single frame: SC-006 asks that across ten cold
 * launches the app never shows the other theme, and a one-frame flash is not
 * something Maestro or any other blackbox driver can see. What it *can* be is a
 * row in a table, so every row of data-model.md §5 is walked here — including
 * the three pre-answer rows, which are the ones a refactor is most likely to
 * quietly reorder.
 */

import assert from "node:assert/strict";

import { resolveTheme, type ThemeResolutionInput } from "./theme-resolution.ts";
import type { PreferenceSource, ThemeMode, UserPreference } from "apis";

function pref(themeMode: ThemeMode, preferenceSource: PreferenceSource, exists = true): UserPreference {
  return { themeMode, preferenceSource, exists };
}

/** Defaults chosen so each case below states only what it is about. */
function input(overrides: Partial<ThemeResolutionInput> = {}): ThemeResolutionInput {
  return {
    signedIn: true,
    osScheme: "light",
    cachedTheme: null,
    deviceLastKnown: null,
    serverPreference: null,
    ...overrides,
  };
}

// ── Row 1 — signed out follows the phone, and writes nothing (FR-014) ────────
{
  for (const osScheme of ["light", "dark"] as const) {
    const out = resolveTheme(input({ signedIn: false, osScheme }));
    assert.equal(out.mode, osScheme, "a signed-out app paints what the phone is set to");
    assert.equal(out.source, "os_default");
    assert.equal(out.followsOS, true);
    assert.equal(out.writeBack, null, "a signed-out app has nobody to write a preference for");
    assert.equal(out.cacheWrite, null, "and nobody to cache one against");
  }

  // A stored preference for the person who *was* signed in must not leak into the
  // signed-out app — row 1 wins before any of it is read.
  const out = resolveTheme(
    input({
      signedIn: false,
      osScheme: "light",
      cachedTheme: "dark",
      deviceLastKnown: "dark",
      serverPreference: pref("dark", "manual"),
    })
  );
  assert.equal(out.mode, "light", "signed out ignores every stored value");
  assert.equal(out.source, "os_default");
}

// ── Row 2 — a deliberate choice governs, and the phone is ignored (FR-009, FR-012)
{
  for (const chosen of ["light", "dark"] as const) {
    const opposite: ThemeMode = chosen === "dark" ? "light" : "dark";
    const out = resolveTheme(input({ osScheme: opposite, serverPreference: pref(chosen, "manual") }));
    assert.equal(out.mode, chosen, "a manual preference beats the phone's setting");
    assert.equal(out.source, "manual");
    assert.equal(out.followsOS, false, "a manual preference pins the native controls");
    assert.equal(out.writeBack, null, "reading a preference is not a reason to write one");
    assert.equal(out.cacheWrite, chosen, "the choice is mirrored locally for the next launch");
  }
}

// ── Row 3 — an os_default row keeps following the phone (FR-011) ─────────────
{
  // The phone has not moved since the row was written: nothing to re-record.
  const unchanged = resolveTheme(
    input({ osScheme: "dark", serverPreference: pref("dark", "os_default") })
  );
  assert.equal(unchanged.mode, "dark");
  assert.equal(unchanged.source, "os_default");
  assert.equal(unchanged.followsOS, true);
  assert.equal(
    unchanged.writeBack,
    null,
    "a foreground refetch that changes nothing must not turn into a write"
  );
  assert.equal(unchanged.cacheWrite, "dark");

  // The phone has moved. The stored row mirrors the phone, so it is re-recorded —
  // still as os_default, because nobody chose anything.
  const moved = resolveTheme(
    input({ osScheme: "dark", serverPreference: pref("light", "os_default") })
  );
  assert.equal(moved.mode, "dark", "the phone's new setting is what is painted");
  assert.equal(moved.source, "os_default");
  assert.deepEqual(moved.writeBack, { mode: "dark", source: "os_default" });
  assert.notEqual(moved.writeBack?.source, "manual", "following the phone is never a manual choice");
  assert.equal(moved.cacheWrite, "dark");
}

// ── Row 4 — no row yet: adopt the phone and record the adoption (FR-010, FR-013)
{
  const out = resolveTheme(
    input({ osScheme: "dark", serverPreference: pref("light", "os_default", false) })
  );
  assert.equal(out.mode, "dark", "a person with no row follows their phone");
  assert.equal(out.source, "os_default");
  assert.equal(out.followsOS, true);
  assert.deepEqual(out.writeBack, { mode: "dark", source: "os_default" });
  assert.equal(out.cacheWrite, "dark");
}

// ── FR-018 — a stored value the app cannot read is *no* preference ───────────
{
  // getUserPreference coerces an unrecognised proto enum to 'light'. Keying off
  // `themeMode` would pin such a person to light forever; keying off `exists`
  // makes them follow their phone. The coerced value is indistinguishable from a
  // real 'light', which is exactly why `exists` is the only signal used.
  const coerced = resolveTheme(
    input({ osScheme: "dark", serverPreference: pref("light", "os_default", false) })
  );
  assert.equal(coerced.mode, "dark", "an unreadable stored value must not pin the app to light");
  assert.equal(coerced.source, "os_default");
}

// ── Row 5 — before the server answers, this person's cached theme paints (FR-016)
{
  const out = resolveTheme(input({ osScheme: "light", cachedTheme: "dark", deviceLastKnown: "light" }));
  assert.equal(out.mode, "dark", "the per-person cache beats the device key");
  assert.equal(out.source, "os_default", "a cached value is not evidence anybody chose it");
  assert.equal(out.followsOS, true, "a provisional row must not pin Appearance");
  assert.equal(out.writeBack, null, "a provisional row never writes to the server");
  assert.equal(out.cacheWrite, null, "and never writes back into the cache it just read");
}

// ── Row 6 — frame zero, before employeeId is readable (FR-016, R4) ───────────
{
  const out = resolveTheme(input({ osScheme: "light", deviceLastKnown: "dark" }));
  assert.equal(out.mode, "dark", "the device key paints the first frame");
  assert.equal(out.source, "os_default");
  assert.equal(out.followsOS, true);
  assert.equal(out.writeBack, null);
  assert.equal(out.cacheWrite, null);
}

// ── Row 7 — nothing known at all: follow the phone, never block (FR-017) ─────
{
  for (const osScheme of ["light", "dark"] as const) {
    const out = resolveTheme(input({ osScheme }));
    assert.equal(out.mode, osScheme);
    assert.equal(out.source, "os_default");
    assert.equal(out.followsOS, true);
    assert.equal(out.writeBack, null, "an unreachable server is not a reason to write");
    assert.equal(out.cacheWrite, null);
  }
}

// ── Ordering — the server's answer supersedes every provisional row ──────────
{
  const provisional = input({ osScheme: "light", cachedTheme: "dark", deviceLastKnown: "dark" });
  assert.equal(resolveTheme(provisional).mode, "dark");

  const answered = resolveTheme({ ...provisional, serverPreference: pref("light", "manual") });
  assert.equal(answered.mode, "light", "the answer wins over the cache that stood in for it");
  assert.equal(answered.source, "manual");
}

// ── FR-013 — nothing in this table may ever write 'manual' ───────────────────
{
  const modes: ThemeMode[] = ["light", "dark"];
  const maybeNull = [null, "light", "dark"] as const;
  const prefs: Array<UserPreference | null> = [
    null,
    pref("light", "manual"),
    pref("dark", "manual"),
    pref("light", "os_default"),
    pref("dark", "os_default"),
    pref("light", "os_default", false),
    pref("dark", "manual", false),
  ];

  let cases = 0;
  for (const signedIn of [true, false]) {
    for (const osScheme of modes) {
      for (const cachedTheme of maybeNull) {
        for (const deviceLastKnown of maybeNull) {
          for (const serverPreference of prefs) {
            const out = resolveTheme({
              signedIn,
              osScheme,
              cachedTheme,
              deviceLastKnown,
              serverPreference,
            });
            cases += 1;
            assert.notEqual(
              out.writeBack?.source,
              "manual",
              "only the Settings control may record a deliberate choice"
            );
            assert.ok(
              out.mode === "light" || out.mode === "dark",
              "there is no third mode and no loading mode"
            );
            assert.equal(
              out.followsOS,
              out.source === "os_default",
              "followsOS is exactly 'the app is not pinned to a deliberate choice'"
            );
            if (out.writeBack !== null) {
              assert.equal(
                out.writeBack.mode,
                out.mode,
                "the app never stores a theme different from the one it is painting"
              );
            }
          }
        }
      }
    }
  }
  assert.equal(cases, 2 * 2 * 3 * 3 * 7, "every input combination was walked");
}

console.log("theme-resolution: ok");
