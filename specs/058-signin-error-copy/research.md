# Phase 0 Research: Sign-In Errors Written for the Person Reading Them

**Branch**: `058-signin-error-copy` | **Date**: 2026-09-12 | **Spec**:
[spec.md](./spec.md)

Everything this feature touches lives in one file. The research below is what reading that
file settled, plus the four questions the spec left open.

## 1. Where the two offending alerts actually are

`frontend/apps/mobile/src/app/(auth)/signin.tsx` — the only file in the repository that
contains either string.

| Line (pre-change) | Code | Message |
|---|---|---|
| ~242 | `onAppleSignIn`, after `AppleAuthentication.isAvailableAsync()` returns false | "This iOS build does not have Sign in with Apple enabled yet. Rebuild the app after syncing native changes." |
| ~292 | `onGoogleSignIn`, `Platform.OS === "android" && !GOOGLE_ANDROID_CLIENT_ID` | "Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in the app environment." |

The Google client identifiers are declared at module scope: `GOOGLE_IOS_CLIENT_ID` is a
hard-coded literal, `GOOGLE_ANDROID_CLIENT_ID` is `process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`.
This confirms the spec's assumption that only the Android identifier can go missing in
practice, while leaving the rule worth writing per-platform.

There is also a third, now-unreachable alert: `onAppleSignIn` guards `Platform.OS !== "ios"`
with "Apple sign-in is only available on iOS devices." The Apple button is already rendered
inside `{Platform.OS === "ios" ? … : null}`, so this branch cannot fire today and will be
even more unreachable once availability gates the render. It is deleted, not reworded.

## 2. Decisions

### D1 — Availability is a pure function plus one async answer

**Decision**: Put the rule in a new pure module
`frontend/apps/mobile/src/lib/sso-availability.ts` exporting `resolveSSOAvailability(input)`,
and call it from a small `useSSOAvailability()` hook in the same file that owns the one
asynchronous input (`AppleAuthentication.isAvailableAsync()`).

**Rationale**: The decision table — platform, client identifier presence, the device's Apple
answer — is the part that can regress and the part worth testing. Keeping it pure means it
is exercised by a Node self-check with no simulator, which is the only form of automated
coverage this screen can realistically get (see D4). The hook is a thin wrapper: state
starts at "not yet known", one effect resolves it.

**Alternatives considered**: computing availability inline in `SignInScreen` — rejected
because nothing then holds the diagnostic and the copy rule in one testable place, and the
render body is already ~300 lines. A context provider shared with other auth screens —
rejected as speculative; `signin.tsx` is the only screen with SSO buttons.

### D2 — "Not yet known" renders nothing (FR-005)

**Decision**: `resolveSSOAvailability` returns `apple: false` until
`isAvailableAsync()` resolves; the hook exposes `resolved` so the caller never renders an
Apple button on the first frame and then pulls it away.

**Rationale**: FR-005 forbids the flash. `isAvailableAsync()` resolves in the same tick on a
real device, but "usually fast" is not "never visible", and the ordering is free to get
right at the start.

**Alternatives considered**: rendering optimistically and hiding on the answer — rejected
by FR-005 directly. A skeleton placeholder — rejected; it re-introduces the layout shift
this is meant to avoid and the section is a secondary affordance nobody is waiting on.

Google needs no async input: its availability is known synchronously from `Platform.OS` and
the client identifier, so it renders on the first frame.

### D3 — The development diagnostic is `console.warn` under `__DEV__`, once per mount

**Decision**: Emit from the hook's mount effect, guarded by `__DEV__`, with a ref so a
re-render cannot repeat it.

**Rationale**: [ASSUMPTION: `__DEV__` + `console.warn` is what the spec's "standard
development-build console diagnostic" means here, because that is what the app already
does — `src/lib/constants.ts:106`, `src/app/_layout.tsx:81`, `(app)/_layout.tsx:119` all
guard development-only behaviour on `__DEV__`, and Metro strips the branch from release
bundles. No new logging dependency is introduced.] The mount effect is also exactly the
"at most once per screen mount" FR-012 asks for, without a module-level flag that would
survive a remount and hide the diagnostic from an engineer who navigated away and back.

**Alternatives considered**: `console.error` — rejected, it triggers the red-box overlay in
development and a missing Android client identifier is not a crash. A module-level
`hasLogged` flag — rejected per the remount argument above.

### D4 — The FR-014 automated check is one `.check.ts` in the existing house style

**Decision**: Add `frontend/apps/mobile/src/lib/sso-availability.check.ts`, run by
`pnpm --filter mobile check:sso-availability`, wired into `make test-frontend` alongside the
existing checks. It does two things: walks the availability decision table, and reads every
`src/app/(auth)/*.tsx` file, extracts their string literals, and fails on
build-configuration vocabulary.

**Rationale**: The repository already has four of these —
`check:theme-resolution`, `check:doc-rows`, `check:device-timezone`, `check:voice-state` —
each a `node --experimental-strip-types` script using `node:assert/strict`, and
`make test-frontend` already runs two of them before the Playwright suite. There is no unit
test runner in the mobile app to add to and no reason to introduce one for this.

**How the copy scan avoids false positives**: it tests only string literals, and skips any
literal matching `/^[a-z0-9.\-\/]+$/` — that exempts testIDs, route paths and SF Symbol
names such as `"building.2"` while catching every sentence. The banned patterns are
word-bounded (`\bbuild\b` does not match `building`). `process.env.EXPO_PUBLIC_…` is a
member expression, not a string literal, so the real configuration read is untouched while a
reintroduced `"…EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID…"` message fails the build.

**Alternatives considered**: an ESLint `no-restricted-syntax` rule — rejected per the
project's stated preference for a small check over new lint infrastructure, and because the
existing lint run already carries 178 pre-existing problems, so a new rule's signal would
land in noise. A Maestro assertion — rejected; Maestro cannot see a string that is never
rendered because the button is gone.

### D5 — Layout: the single-provider case is already correct

**Decision**: No layout change is needed for FR-004. Verify and move on.

**Rationale**: `ssoButtonsRow` is named "row" but declares only `{ gap: 10 }` — no
`flexDirection: "row"` — so the buttons already stack vertically at full width. Hiding one
leaves the other full width with no gap beside it, which is what FR-004 asks for. What does
need doing is FR-003: the `dividerRow` and the SSO `card` (including its "SSO uses the
workspace above…" support text) are siblings of the form and must be omitted together when
neither provider is available.

[ASSUMPTION: the misleading `ssoButtonsRow` name is left alone. Renaming it is unrelated
churn in a file this feature is already editing for a different reason.]

### D6 — Message rewrite

**Decision**: Every remaining alert on the screen names email and password as the way
through. Concretely:

| Trigger | Today | After |
|---|---|---|
| Apple unavailable at tap | "This iOS build does not have Sign in with Apple enabled yet. Rebuild…" | "Apple sign-in isn't available on this device. Sign in with your email and password above." |
| Google unavailable at tap | "Google sign-in for Android still needs EXPO_PUBLIC_…" | "Google sign-in isn't available on this device. Sign in with your email and password above." |
| Non-iOS Apple tap | "Apple sign-in is only available on iOS devices." | *(branch deleted — unreachable)* |
| Google request not ready | "Google sign-in is still initializing. Try again in a moment." | unchanged (US2 AS2) |
| Google returned no ID token | "Google did not return an ID token for this app." | "Google sign-in didn't finish. Sign in with your email and password above." |
| Google response type `error` | "Google sign-in did not complete." | "Google sign-in didn't work this time. Sign in with your email and password above." |
| SSO exchange threw | provider/network message verbatim | provider message, then "Sign in with your email and password above." |
| Missing subdomain (thrown from `completeSSOSignIn`) | "Workspace subdomain is required before using SSO." | "Enter your workspace subdomain above, then try again." |
| Missing subdomain (pre-tap guard) | "Enter your workspace subdomain before continuing with Google sign-in." | unchanged (already actionable) |
| Email/password sign-in failed | error message verbatim | unchanged — out of scope, contains no build vocabulary |
| Person cancelled Apple sheet | *(no alert)* | unchanged (US2 AS4) |

**Rationale**: FR-009 requires every failure message to state an action the reader can
perform. "Sign in with your email and password above" is that action on this screen, and it
is literally above the alternatives section. The pass-through of provider error text is
kept per the spec's edge case, with this app's framing appended rather than replacing it.

[ASSUMPTION: alert titles drop the "Failed"/"Unavailable" capital-case shouting only where
the body changes anyway — "Google Sign-In Failed" stays as a title because it is a label,
not a diagnosis, and retitling every alert is scope the spec did not ask for.]

### D7 — Nothing outside the mobile client moves

No proto, no RPC, no database, no web page. `exchangeTokenForOrganization` and
`getOrganizationBySubdomain` are called exactly as they are today (FR-013). The web sign-in
page at `frontend/apps/web/src/app/signin/page.tsx` mentions Sign in with Apple but raises
no build-configuration message, and the spec scopes it out.

## 3. Resolved unknowns

The spec carried no `[NEEDS CLARIFICATION]` markers. Its seven assumptions were all checked
against the code and all hold, with one refinement: FR-004's "half-width control with a gap
beside it" describes a layout the screen does not have (D5), so that requirement is
satisfied by verification rather than by a change.
