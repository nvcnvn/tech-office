# Quickstart: Sign-In Errors Written for the Person Reading Them

**Branch**: `058-signin-error-copy` | **Date**: 2026-09-12

How to prove this feature works. Level 1 needs nothing but a terminal and is the gate that
runs in CI; levels 2 and 3 need a simulator or device and are what a reviewer reproduces.

## Prerequisites

- `pnpm install` has been run in `frontend/`.
- For level 2 and beyond: an iOS simulator or Android emulator, and the mobile dev client
  (`cd frontend/apps/mobile && pnpm ios` or `pnpm android`). Backend running per the repo's
  usual `make dev-*` targets is only needed for the success path in §3.4.

## 1. Static checks — no device (the CI gate)

```bash
cd frontend
pnpm --filter mobile check:sso-availability    # FR-001…FR-004, FR-007…FR-012, FR-014
pnpm run typecheck:mobile
pnpm run lint
```

`check:sso-availability` is the new check and covers two things:

- **The decision table.** Every row of [data-model.md §3](./data-model.md#3-decision-table)
  is walked, including rows 1, 4 and 5 — the "not yet known" row that FR-005 depends on, and
  the two impossible-in-practice iOS rows that exist so a deleted `GOOGLE_IOS_CLIENT_ID`
  fails here instead of in the store.
- **The copy rule.** Every string literal in `src/app/(auth)/*.tsx` is tested against the
  banned vocabulary in [data-model.md §4](./data-model.md#4-signinmessage). This is the
  FR-014 tripwire: reintroducing `"…EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID…"` in any auth
  screen fails the build.

Expected: all three exit 0. `pnpm run lint` currently reports pre-existing problems across
the repository; the bar is that the count does not rise, not that it is zero.

The check is also reachable through `make test-frontend`, which runs it alongside
`check:theme-resolution` before the Playwright suite.

**Quick proof the tripwire bites** — this must fail, then revert it:

```bash
# in frontend/apps/mobile/src/app/(auth)/signin.tsx, change any alert body to
#   "Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID."
cd frontend && pnpm --filter mobile check:sso-availability   # expect a non-zero exit naming the file and the literal
git checkout -- apps/mobile/src/app/\(auth\)/signin.tsx
```

## 2. Android with no Google client identifier — the headline case

This is US1's independent test and the state a store reviewer can land in.

```bash
cd frontend/apps/mobile
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID= pnpm android
```

Then: open the app → "Sign in with email instead" (or navigate to `/(auth)/signin`).

Expect:

- **No Continue with Google button.** There is nothing to tap, so no alert can be raised
  (SC-002: taps-to-discover drops from one to zero).
- **No "or continue with" divider, no alternatives card, no "SSO uses the workspace above…"
  support text** — Apple is not offered on Android either, so row 7 of the decision table
  hides the whole section (FR-003). The email and password form is the entire screen, with
  no empty card and no orphan rule.
- **In the Metro console**: one warning naming `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
  (FR-010, SC-005). Navigate away and back — it appears once per mount, not per render
  (FR-012).

Then run it *with* the identifier set (the normal `pnpm android`) and confirm the Google
button, divider and card are all back and sign-in still completes (FR-013).

## 3. iOS

### 3.1 Apple unavailable

On a simulator signed out of iCloud, or any device where
`AppleAuthentication.isAvailableAsync()` returns false:

```bash
cd frontend/apps/mobile && pnpm ios
```

Expect the Apple button absent, the Google button present at full width with no gap beside
it (FR-004), and a development-only console line recording the Apple result. No flash: the
Apple button must never appear and then disappear (FR-005) — watch the first frame, and if
it is too fast to judge, trust row 1 of the decision table, which the level-1 check asserts.

### 3.2 Both providers hidden — layout

Force row 5 by emptying `GOOGLE_IOS_CLIENT_ID` locally on a device where Apple is
unavailable. Expect the same all-hidden layout as §2. Check it on the smallest supported
iPhone (SE) as well as a narrow Android viewport (SC-006) — there should be no leftover
padding where the section was.

### 3.3 Read every alert (US2)

Trigger each remaining path and read the text. None may contain an environment variable
name, `rebuild`, `not enabled yet`, or any reference to native or build configuration
(FR-007, FR-008, SC-001, SC-004); each must name something the reader can do (FR-009,
SC-003):

| How to trigger | Expect |
|---|---|
| Tap Google before the auth request finishes initialising | "Google sign-in is still initializing. Try again in a moment." — unchanged |
| Tap Google with the workspace field empty | "Enter your workspace subdomain before continuing with Google sign-in." — unchanged |
| Sign out of iCloud with the screen already open, then tap Apple | names signing in with email and password (FR-006) |
| Cancel the Apple sheet | **no alert at all** (US2 AS4) |
| Kill network mid-exchange | the provider's own message, followed by this app's "sign in with your email and password above" framing |

### 3.4 The success path is untouched (FR-013)

With a configured build and the backend running, complete a real Google sign-in and a real
Apple sign-in. Same workspace-subdomain requirement, same token exchange, same destination
(`/(app)/(chat)` or the pending redirect). Nothing about this step should feel different
from `main`.

## 4. Release build — the diagnostic is gone (FR-011)

```bash
cd frontend/apps/mobile
pnpm exec expo export --platform android          # or an EAS release build
grep -r "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID" dist/ | grep -v sourcemap
```

Expect no match in the emitted bundle outside source maps: the diagnostic lives inside an
`if (__DEV__)` branch that Metro strips from a production bundle. Also confirm by
inspection that nothing in the interface surfaces the configuration in any build.

## 5. Maestro

`frontend/apps/mobile/.maestro/auth/signin.yaml` exercises the email-and-password happy
path and must keep passing unchanged — this feature removes buttons that flow never taps.

```bash
cd frontend/apps/mobile && pnpm maestro:suite
```

Per Principle XIII, edge and error states stay out of Maestro: a hidden button is not
something a blackbox driver can assert the absence of meaningfully, which is exactly why
FR-014's coverage is the level-1 check instead.
