/**
 * Self-check for the SSO availability table and the sign-in copy rule. Run with
 * `pnpm --filter mobile check:sso-availability`.
 *
 * Two failures are guarded here, neither of which any device test can see.
 *
 * The first is a provider button that renders when it cannot complete a
 * sign-in. Maestro cannot assert the absence of a control it was never told
 * about, and the iOS rows below cannot happen on a correctly built app at all —
 * they exist so that emptying the compiled-in `GOOGLE_IOS_CLIENT_ID` fails here
 * rather than in front of a store reviewer.
 *
 * The second is the regression this feature exists to prevent: an alert that
 * explains the app's build configuration to the person holding the phone.
 * "Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
 * in the app environment" was shipped copy. The scan below reads every string
 * literal on every auth screen so it cannot come back quietly.
 */

import assert from "node:assert/strict";

import {
  resolveSSOAvailability,
  type SSOAvailabilityInput,
  type SSOAvailability,
  type SSOGap,
} from "./sso-availability.ts";

/** Defaults chosen so each case below states only what it is about. */
function input(overrides: Partial<SSOAvailabilityInput> = {}): SSOAvailabilityInput {
  return {
    platform: "ios",
    googleClientId: "some-client-id.apps.googleusercontent.com",
    appleAvailable: true,
    ...overrides,
  };
}

function expect(
  out: SSOAvailability,
  want: Pick<SSOAvailability, "google" | "apple" | "any" | "resolved">,
  row: string
) {
  assert.equal(out.google, want.google, `${row}: google`);
  assert.equal(out.apple, want.apple, `${row}: apple`);
  assert.equal(out.any, want.any, `${row}: any`);
  assert.equal(out.resolved, want.resolved, `${row}: resolved`);
  assert.equal(out.any, out.google || out.apple, `${row}: any must be google || apple`);
}

/** The three shapes an absent client identifier arrives in. */
const ABSENT = [undefined, "", "   "] as const;

// ── Row 1 — iOS, the Apple answer is still outstanding (FR-005) ──────────────
{
  const out = resolveSSOAvailability(input({ appleAvailable: null }));
  expect(out, { google: true, apple: false, any: true, resolved: false }, "row 1");
  // Google needs nothing asynchronous, so it renders on the first frame while
  // Apple waits. What must never happen is an Apple button appearing here and
  // being pulled away when the answer lands.
}

// ── Row 2 — iOS, both providers available ───────────────────────────────────
{
  const out = resolveSSOAvailability(input({ appleAvailable: true }));
  expect(out, { google: true, apple: true, any: true, resolved: true }, "row 2");
}

// ── Row 3 — iOS, the device says no to Apple ────────────────────────────────
{
  const out = resolveSSOAvailability(input({ appleAvailable: false }));
  expect(out, { google: true, apple: false, any: true, resolved: true }, "row 3");
}

// ── Row 4 — iOS with no Google client identifier, Apple available ───────────
// Cannot occur in a correctly built app; this row is the tripwire on the
// compiled-in literal.
for (const googleClientId of ABSENT) {
  const out = resolveSSOAvailability(input({ googleClientId, appleAvailable: true }));
  expect(out, { google: false, apple: true, any: true, resolved: true }, "row 4");
}

// ── Row 5 — iOS with neither provider: the whole section goes ───────────────
for (const googleClientId of ABSENT) {
  const out = resolveSSOAvailability(input({ googleClientId, appleAvailable: false }));
  expect(out, { google: false, apple: false, any: false, resolved: true }, "row 5");
}

// ── Row 6 — Android with a client identifier. Apple is never offered ────────
for (const appleAvailable of [null, true, false] as const) {
  const out = resolveSSOAvailability(input({ platform: "android", appleAvailable }));
  expect(out, { google: true, apple: false, any: true, resolved: true }, "row 6");
  // Android has no asynchronous input, so it is resolved on the first frame
  // whatever the Apple state happens to be.
}

// ── Row 7 — Android with no client identifier: the headline case ────────────
for (const googleClientId of ABSENT) {
  for (const appleAvailable of [null, true, false] as const) {
    const out = resolveSSOAvailability(
      input({ platform: "android", googleClientId, appleAvailable })
    );
    expect(out, { google: false, apple: false, any: false, resolved: true }, "row 7");
  }
}

// ── Row 8 — anything else Expo may report is a target for neither ───────────
for (const platform of ["web", "windows", "macos"]) {
  for (const googleClientId of [...ABSENT, "a-client-id"]) {
    const out = resolveSSOAvailability(input({ platform, googleClientId, appleAvailable: null }));
    expect(out, { google: false, apple: false, any: false, resolved: true }, "row 8");
  }
}


// ── What the developer is told (FR-010) ────────────────────────────────────
// The gaps are data, so they are asserted on the return value — no console spy
// and nothing rendered. The wording itself cannot live out here: it has to sit
// inside the hook's `if (__DEV__)` block for Metro to strip it from a release
// bundle, so it is checked as source text further down.
{
  const gapsFor = (overrides: Partial<SSOAvailabilityInput>) =>
    resolveSSOAvailability(input(overrides)).gaps;

  // Rows 1, 2, 6 and 8 — nothing is missing, so there is nothing to say.
  assert.deepEqual(gapsFor({ appleAvailable: null }), [], "row 1");
  assert.deepEqual(gapsFor({ appleAvailable: true }), [], "row 2");
  assert.deepEqual(gapsFor({ platform: "android", appleAvailable: null }), [], "row 6");
  assert.deepEqual(
    gapsFor({ platform: "web", googleClientId: undefined }),
    [],
    "row 8: an unsupported platform is not a missing configuration value"
  );

  // Row 3 — Google is fine; the device is the reason the Apple button is gone.
  assert.deepEqual(gapsFor({ appleAvailable: false }), ["apple-unavailable-on-device"], "row 3");

  // Row 4 — the compiled-in iOS identifier was emptied. Cannot happen in a
  // correctly built app, which is exactly why it is asserted here.
  assert.deepEqual(
    gapsFor({ googleClientId: "", appleAvailable: true }),
    ["google-ios-client-id-missing"],
    "row 4"
  );

  // Row 5 — both at once, reported in one line rather than two.
  assert.deepEqual(
    gapsFor({ googleClientId: "", appleAvailable: false }),
    ["google-ios-client-id-missing", "apple-unavailable-on-device"],
    "row 5"
  );

  // Row 7 — the headline case, and the one an engineer actually hits.
  for (const googleClientId of ABSENT) {
    assert.deepEqual(
      gapsFor({ platform: "android", googleClientId, appleAvailable: null }),
      ["google-android-client-id-missing"],
      "row 7"
    );
  }
}

// ── The copy rule (FR-007, FR-008, FR-009) ──────────────────────────────────
// Every auth screen is read, not just signin.tsx: the message this feature
// deletes would be just as wrong on the PIN screen or the invitation screen,
// and the whole point of a scan is that it covers the places nobody thought of.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "(auth)");

/**
 * Vocabulary that describes the app's construction rather than anything the
 * reader can do. Word-bounded so `\bbuild\b` leaves "building.2" alone, and
 * case-insensitive so a capitalised retelling does not slip through.
 */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEXPO_PUBLIC_\w*/i, "names an environment variable"],
  [/\bre-?builds?\b/i, "asks the reader to rebuild the app"],
  [/\bbuilds?\b/i, "talks about the build"],
  [/\bnative\b/i, "talks about native code"],
  [/\bSDKs?\b/i, "names an SDK"],
  [/\benvironment variables?\b/i, "names an environment variable"],
  [/\bclient ids?\b/i, "names a client identifier"],
  [/\bnot enabled yet\b/i, "describes an unfinished build"],
  [/\bstill needs\b/i, "describes missing configuration"],
  [/\bnot configured\b/i, "describes missing configuration"],
  [/\bnot implemented\b/i, "describes unwritten code"],
  [/\bcoming soon\b/i, "promises future work instead of offering a way through"],
];

/**
 * Literals that are not prose: testIDs, route paths, SF Symbol names such as
 * `building.2`. No person ever reads one, so neither rule applies.
 */
const NOT_PROSE = /^[a-z0-9.\-/]+$/;

/**
 * Pull the text out of every string and template literal. A deliberately small
 * scanner rather than a parser: it has to understand escapes and quoting well
 * enough not to lie, and nothing more. Comments are stripped first so that the
 * prose in this file's own neighbours — which legitimately discusses builds and
 * environment variables — is not mistaken for something shown to a person.
 */
function stringLiterals(source: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let text = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          text += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        // Inside a template literal, `${…}` is an expression, not prose.
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            i += 1;
          }
          text += " ";
          continue;
        }
        text += source[i];
        i += 1;
      }
      i += 1;
      found.push(text);
      continue;
    }
    i += 1;
  }
  return found;
}

{
  const screens = readdirSync(AUTH_DIR).filter((name) => name.endsWith(".tsx"));
  assert.ok(screens.length > 0, "no auth screens found — is AUTH_DIR still right?");
  assert.ok(
    screens.includes("signin.tsx"),
    "signin.tsx is the screen this rule exists for; it must be in the scan"
  );

  for (const screen of screens) {
    const source = readFileSync(join(AUTH_DIR, screen), "utf8");
    for (const literal of stringLiterals(source)) {
      if (NOT_PROSE.test(literal.trim())) continue;
      for (const [pattern, why] of BANNED) {
        const hit = pattern.exec(literal);
        if (hit) {
          assert.fail(
            `(auth)/${screen} shows a person a string that ${why}:\n` +
              `  ${JSON.stringify(literal)}\n` +
              `  offending text: ${JSON.stringify(hit[0])}\n` +
              `  Say what the reader can do instead — see spec 058 FR-007.`
          );
        }
      }
    }
  }
}

// ── Every failure message names something the reader can do (FR-009) ────────
// A substring assertion over an enumerated list, not a copy editor: it is a
// tripwire against the class of message this feature deleted, and a human
// reviewer is still the real gate on whether the writing is any good.
{
  const MUST_OFFER_A_WAY_THROUGH = [
    "Apple sign-in isn't available on this device.",
    "Google sign-in isn't available on this device.",
    "Google sign-in didn't finish.",
    "Google sign-in didn't work this time.",
    "Google sign-in is still initializing.",
    "Enter your workspace subdomain above, then try again.",
    "Enter your workspace subdomain before continuing with Google sign-in.",
  ];

  const signin = readFileSync(join(AUTH_DIR, "signin.tsx"), "utf8");
  const literals = stringLiterals(signin);

  for (const prefix of MUST_OFFER_A_WAY_THROUGH) {
    const message = literals.find((literal) => literal.includes(prefix));
    assert.ok(
      message !== undefined,
      `signin.tsx no longer contains the message starting "${prefix}". ` +
        `If it was deliberately reworded, update this list; if it was deleted, remove the entry.`
    );
    assert.match(
      message,
      /email and password|try again|in a moment|Enter your workspace subdomain/,
      `"${prefix}" tells the reader something failed without telling them what to do next (FR-009)`
    );
  }
}

// ── …and that it still names the configuration value (FR-010, FR-011) ──────
// The wording is read as source text because it deliberately lives inside the
// hook's `if (__DEV__)` block, which is a file Node cannot import (react-native
// again) and which Metro removes from release bundles. Reading it here keeps
// the two halves — which gap, and what the engineer is told about it — from
// drifting apart silently.
{
  const HOOK = join(dirname(fileURLToPath(import.meta.url)), "use-sso-availability.ts");
  const source = readFileSync(HOOK, "utf8");

  assert.match(
    source,
    /if \(__DEV__\) \{/,
    "the diagnostic must sit inside an `if (__DEV__) {` block or Metro will ship its wording"
  );

  const NAMES: ReadonlyArray<readonly [SSOGap, RegExp]> = [
    ["google-android-client-id-missing", /EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID/],
    ["google-ios-client-id-missing", /GOOGLE_IOS_CLIENT_ID/],
    ["apple-unavailable-on-device", /Sign in with Apple is unavailable/],
  ];

  const devBlock = source.slice(source.indexOf("if (__DEV__) {"));
  for (const [gap, names] of NAMES) {
    assert.ok(
      devBlock.includes(gap),
      `use-sso-availability.ts never handles the "${gap}" gap, so an engineer hitting it is told nothing (FR-010)`
    );
    assert.match(
      devBlock,
      names,
      `the "${gap}" diagnostic no longer names the configuration value it is about (FR-010)`
    );
  }
}

console.log("sso-availability: ok");
