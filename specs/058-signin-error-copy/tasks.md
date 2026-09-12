# Tasks: Sign-In Errors Written for the Person Reading Them

**Input**: Design documents from `/specs/058-signin-error-copy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [quickstart.md](./quickstart.md)

**Tests**: The feature specification requires one automated check (FR-014), so the
`sso-availability.check.ts` tasks below are in scope. No unit-test runner is introduced —
the check is a Node self-check in the mobile app's existing house style (research D4). The
existing Maestro suite must keep passing unchanged; no new Maestro flow is written
(Constitution XIII directs error states away from Maestro).

**Organization**: Tasks are grouped by user story so each story can be implemented and
verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task

## Path Conventions

This is a mobile-client-only change in a pnpm monorepo. All source paths are relative to the
repository root:

- Mobile app: `frontend/apps/mobile/`
- The one screen: `frontend/apps/mobile/src/app/(auth)/signin.tsx`
- Pure logic + self-checks: `frontend/apps/mobile/src/lib/`

No backend, proto, database, or web-app path is touched.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the green baseline this change must not regress.

- [X] T001 Record the baseline from `frontend/`: run `pnpm --filter mobile check:theme-resolution`, `pnpm run typecheck:mobile`, and `pnpm run lint`, and write down the current `lint` problem count (the bar is that it does not rise — see [quickstart.md §1](./quickstart.md#1-static-checks--no-device-the-ci-gate)); confirm `frontend/apps/mobile/.maestro/auth/signin.yaml` passes via `pnpm maestro:suite` or note it as unavailable in this environment

**Checkpoint**: Baseline known; any later failure is attributable to this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The availability module every user story reads from. US1 gates rendering on it,
US2's tap-time guards call it, US3 emits the `diagnostic` it produces.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Create `frontend/apps/mobile/src/lib/sso-availability.ts` exporting the `SSOAvailabilityInput` and `SSOAvailability` types exactly as specified in [data-model.md §1–§2](./data-model.md#1-ssoavailabilityinput) — `input: { platform, googleClientId, appleAvailable }`, `output: { google, apple, any, resolved, diagnostic }` — with no React or Expo import in the module's pure section so it is loadable by `node --experimental-strip-types`
- [X] T003 Implement the pure `resolveSSOAvailability(input): SSOAvailability` in `frontend/apps/mobile/src/lib/sso-availability.ts` covering all eight rows of the [data-model.md §3 decision table](./data-model.md#3-decision-table), including: `googleClientId` treated as absent when `undefined`, `""` or whitespace-only; `apple` false while `appleAvailable === null` with `resolved: false` (FR-005, row 1); `any = google || apple` (FR-003); `diagnostic` returned as a string naming the missing configuration value or `null`, never logged from inside this function (FR-010)
- [X] T004 Move the Google client-identifier constants into `frontend/apps/mobile/src/lib/sso-availability.ts` as exported `GOOGLE_IOS_CLIENT_ID` (the existing compiled literal) and `GOOGLE_ANDROID_CLIENT_ID` (`process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`), delete their declarations at `frontend/apps/mobile/src/app/(auth)/signin.tsx:54-57`, and import them there so `useIdTokenAuthRequest` at `signin.tsx:85-86` and the availability rule read one source of truth
- [X] T005 Add the `useSSOAvailability(): SSOAvailability` hook to `frontend/apps/mobile/src/lib/sso-availability.ts` — `useState<boolean | null>(null)` for the Apple answer, one mount `useEffect` that calls `AppleAuthentication.isAvailableAsync()` only when `Platform.OS === "ios"` and ignores the result after unmount, then returns `resolveSSOAvailability({ platform: Platform.OS, googleClientId: <ios|android constant>, appleAvailable })`; no `console` call in this task (US3 adds it)

**Checkpoint**: `resolveSSOAvailability` is importable and pure; `useSSOAvailability` compiles. User stories can now proceed.

---

## Phase 3: User Story 1 - A provider that cannot work is not offered (Priority: P1) 🎯 MVP

**Goal**: A sign-in provider that cannot complete a sign-in on this build and device is not
rendered as a control at all, and when neither can, the entire alternatives section —
divider, card and support text — disappears with it.

**Independent Test**: Launch the app on an Android build started with
`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=` and open the email-and-password sign-in screen:
no Continue with Google button, no "or continue with" divider, no alternatives card, no
leftover padding. Repeat on an iOS simulator signed out of iCloud: no Apple button, Google
button full width. Fully testable with nothing from US2 or US3 built.

### Check for User Story 1

- [X] T006 [US1] Create `frontend/apps/mobile/src/lib/sso-availability.check.ts` in the style of `frontend/apps/mobile/src/lib/theme-resolution.check.ts` (module docstring explaining what failure it guards, `import assert from "node:assert/strict"`, an `input()` helper with defaults) and assert every one of the eight rows in [data-model.md §3](./data-model.md#3-decision-table) for `google`, `apple`, `any` and `resolved` — explicitly including row 1 (the FR-005 not-yet-known row) and rows 4 and 5 (the iOS rows that exist so an emptied `GOOGLE_IOS_CLIENT_ID` fails here rather than in the store)
- [X] T007 [US1] Add `"check:sso-availability": "node --experimental-strip-types src/lib/sso-availability.check.ts"` to the `scripts` block of `frontend/apps/mobile/package.json`, beside the existing `check:theme-resolution` entry
- [X] T008 [P] [US1] Add `cd frontend && pnpm --filter mobile check:sso-availability` to the `test-frontend` target in `Makefile` (after the `check:theme-resolution` line at `Makefile:144`, inside the "frontend static checks" block)

### Implementation for User Story 1

- [X] T009 [US1] Call `useSSOAvailability()` at the top of `SignInScreen` in `frontend/apps/mobile/src/app/(auth)/signin.tsx` and destructure `{ google, apple, any }` for use in the render body
- [X] T010 [US1] Gate the Continue with Google button in `frontend/apps/mobile/src/app/(auth)/signin.tsx` (around `signin.tsx:528-551`, `testID="google-sso-button"`) on `google`, preserving its `testID` and every existing prop (FR-002)
- [X] T011 [US1] Replace the `{Platform.OS === "ios" ? … : null}` wrapper around the Apple button in `frontend/apps/mobile/src/app/(auth)/signin.tsx` (around `signin.tsx:552`) with a gate on `apple` — the platform test is now inside `resolveSSOAvailability`, so keeping both would duplicate the rule (FR-002, FR-005)
- [X] T012 [US1] Gate the `dividerRow` block (around `signin.tsx:520`) and the SSO `card` containing the buttons row and its "SSO uses the workspace above…" support text on `any` in `frontend/apps/mobile/src/app/(auth)/signin.tsx`, so that when neither provider is available the email-and-password form is the whole screen with no empty container, no orphan rule and no leftover heading (FR-003)
- [X] T013 [US1] Verify FR-004 by reading `styles.ssoButtonsRow` at `frontend/apps/mobile/src/app/(auth)/signin.tsx:699`: it declares `gap` without `flexDirection: "row"`, so a surviving single button is already full width with no gap beside it (research D5). If that is still true, change nothing and note it in the commit message; if a `flexDirection: "row"` has appeared since, make the single-provider case occupy full width

**Checkpoint**: On an unconfigured build, the dead button and the whole section around it are gone. This is the MVP and the slice a store reviewer sees.

---

## Phase 4: User Story 2 - An alert a person can act on (Priority: P2)

**Goal**: Every message still reachable on the sign-in screen names something the reader can
do — signing in with email and password — and none names an environment variable, a build, a
rebuild, a native module or an SDK.

**Independent Test**: Force each failure path listed in
[quickstart.md §3.3](./quickstart.md#33-read-every-alert-us2) and read the alert; confirm no
build-configuration vocabulary and a performable next action in each. Then run
`pnpm --filter mobile check:sso-availability` and confirm the copy scan passes, and that
pasting the old `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` message back into any auth screen
makes it fail. Depends on nothing in US1.

### Implementation for User Story 2

- [X] T014 [US2] In `onAppleSignIn` in `frontend/apps/mobile/src/app/(auth)/signin.tsx`: delete the unreachable `Platform.OS !== "ios"` branch and its "Apple sign-in is only available on iOS devices." alert (`signin.tsx:241-247`), and replace the `isAvailableAsync()` false alert (`signin.tsx:249-255`) — "This iOS build does not have Sign in with Apple enabled yet. Rebuild the app after syncing native changes." — with "Apple sign-in isn't available on this device. Sign in with your email and password above." Keep the `isAvailableAsync()` call itself as the tap-time guard for a device that withdraws Apple mid-session (FR-006, spec edge case)
- [X] T015 [US2] In `onGoogleSignIn` in `frontend/apps/mobile/src/app/(auth)/signin.tsx` (`signin.tsx:293-298`), delete the message "Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in the app environment." and replace the guard body with "Google sign-in isn't available on this device. Sign in with your email and password above.", keeping a tap-time availability guard so a stale render cannot start a request that cannot succeed (FR-006, FR-007)
- [X] T016 [US2] Rewrite the remaining Google alerts in `frontend/apps/mobile/src/app/(auth)/signin.tsx` per the [research.md D6 table](./research.md#d6--message-rewrite): "Google did not return an ID token for this app." → "Google sign-in didn't finish. Sign in with your email and password above."; "Google sign-in did not complete." (`signin.tsx:118`) → "Google sign-in didn't work this time. Sign in with your email and password above."; leave "Google sign-in is still initializing. Try again in a moment." and "Enter your workspace subdomain before continuing with Google sign-in." unchanged, as both are already actionable (US2 AS2, FR-009)
- [X] T017 [US2] In `completeSSOSignIn` and the provider catch blocks in `frontend/apps/mobile/src/app/(auth)/signin.tsx` (around `signin.tsx:177`, `signin.tsx:229`, `signin.tsx:283`, `signin.tsx:311`): keep the provider's or network's own message verbatim and append this app's framing "Sign in with your email and password above." rather than replacing it; change the thrown "Workspace subdomain is required before using SSO." to "Enter your workspace subdomain above, then try again."; leave the user-cancelled Apple path raising no alert at all (FR-009, FR-010 boundary, US2 AS4, spec edge case on provider-supplied text)
- [X] T018 [US2] Extend `frontend/apps/mobile/src/lib/sso-availability.check.ts` with the FR-014 copy scan: read every `frontend/apps/mobile/src/app/(auth)/*.tsx` file, extract its string literals (including template-literal text), skip any literal matching `/^[a-z0-9.\-\/]+$/` (testIDs, route paths, SF Symbol names like `building.2`), and fail with the file name and the offending literal on any word-bounded case-insensitive match of the banned vocabulary in [data-model.md §4](./data-model.md#4-signinmessage): `EXPO_PUBLIC_*`, `build`, `rebuild`, `native`, `SDK`, `environment variable`, `client id`, `not enabled yet`, `still needs`, `not configured`, `not implemented`, `coming soon` (FR-007, FR-008, SC-001)
- [X] T019 [US2] Add the FR-009 action assertion to `frontend/apps/mobile/src/lib/sso-availability.check.ts`: assert each of the enumerated failure-message literals contains `email and password` or `try again`, using the small enumerated list documented in [data-model.md §4](./data-model.md#4-signinmessage) rather than natural-language analysis (SC-003)
- [X] T020 [US2] Prove the tripwire bites per [quickstart.md §1](./quickstart.md#1-static-checks--no-device-the-ci-gate): temporarily paste `"Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID."` into an alert body in `frontend/apps/mobile/src/app/(auth)/signin.tsx`, confirm `pnpm --filter mobile check:sso-availability` exits non-zero naming the file and the literal, then `git checkout --` the file

**Checkpoint**: No message on the auth screens explains the build to a person, and the check fails the build if one comes back.

---

## Phase 5: User Story 3 - The diagnostic still reaches the developer (Priority: P3)

**Goal**: An engineer on a development build learns which configuration value is missing
without tapping anything; a release build produces nothing.

**Independent Test**: Run `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID= pnpm android`, open the
sign-in screen, and confirm exactly one Metro console warning naming
`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`; navigate away and back and confirm it appears once
per mount, not per render. Then export a release bundle and confirm the string is absent.

### Implementation for User Story 3

- [X] T021 [US3] Emit the diagnostic from the mount effect of `useSSOAvailability()` in `frontend/apps/mobile/src/lib/sso-availability.ts`: when `__DEV__` and `diagnostic !== null`, `console.warn(diagnostic)` — guarded by a `useRef` so a re-render cannot repeat it, and deliberately not a module-level flag, so an engineer who navigates away and back still sees it (FR-010, FR-011, FR-012, research D3). Use `console.warn`, not `console.error`, so a missing identifier does not raise the red-box overlay
- [X] T022 [US3] Extend `frontend/apps/mobile/src/lib/sso-availability.check.ts` to assert the `diagnostic` column of the [decision table](./data-model.md#3-decision-table) directly on the pure function's return value: `null` on rows 1, 2, 6 and 8; naming `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` on row 7; naming the iOS Google client identifier on row 4; naming both on row 5; recording the Apple result on row 3 — no console spy needed, because the diagnostic is data (FR-010)
- [X] T023 [US3] Verify FR-011 per [quickstart.md §4](./quickstart.md#4-release-build--the-diagnostic-is-gone-fr-011): run `pnpm exec expo export --platform android` in `frontend/apps/mobile` and confirm `grep -r "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID" dist/ | grep -v sourcemap` returns no match, proving Metro stripped the `__DEV__` branch

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Update `docs/domain/auth-identity.md` — the mobile `signin` screen is currently described as "email + password + SSO"; record that each single-tap provider is now rendered only when it can complete a sign-in on the running build and device, that the whole alternatives section is omitted when neither can, and that the build-configuration diagnostic is a development-only console line. Delete any description of the two removed alerts (Constitution XII, Definition of Done)
- [X] T025 Run the full level-1 gate from `frontend/`: `pnpm --filter mobile check:sso-availability`, `pnpm run typecheck:mobile`, `pnpm run lint` — all exit 0, and the lint problem count has not risen above the T001 baseline
- [X] T026 Device verification per [quickstart.md §2](./quickstart.md#2-android-with-no-google-client-identifier--the-headline-case) and [§3](./quickstart.md#3-ios): the Android unconfigured case, the Android configured case (button, divider and card all back), the iOS Apple-unavailable case with no first-frame flash, and the both-hidden layout on an iPhone SE and at 360 dp Android width with no leftover padding (SC-006)
- [X] T027 Verify FR-013 per [quickstart.md §3.4](./quickstart.md#34-the-success-path-is-untouched-fr-013): with a configured build and the backend running, complete a real Google sign-in and a real Apple sign-in — same workspace-subdomain requirement, same token exchange, same destination
- [X] T028 Run `pnpm maestro:suite` in `frontend/apps/mobile` and confirm `.maestro/auth/signin.yaml` passes unchanged; do not edit any Maestro flow (the happy path never taps an SSO button)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2 only
- **User Story 2 (Phase 4)**: Depends on Phase 2 only — independent of US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 only — independent of US1 and US2
- **Polish (Phase 6)**: Depends on every story you intend to ship

### User Story Dependencies

- **US1 (P1)**: Independent. Needs `resolveSSOAvailability` + `useSSOAvailability` (T002–T005).
- **US2 (P2)**: Independent. The tap-time guards it rewrites exist today; they do not need US1's render gating to be correct.
- **US3 (P3)**: Independent. Needs only the `diagnostic` field from T003 and the hook from T005.

### Within Each User Story

- The check task comes before or alongside the screen edits it guards — T006 can be written against the table before `signin.tsx` is touched at all.
- T009 must land before T010–T012 (they consume its destructured values).
- T018 and T019 must land after T014–T017, or the copy scan fails on the messages this feature is about to delete.

### File-Contention Notes (why most tasks are not [P])

Three files carry almost every task and must be edited serially:

- `frontend/apps/mobile/src/lib/sso-availability.ts` — T002, T003, T004, T005, T021
- `frontend/apps/mobile/src/lib/sso-availability.check.ts` — T006, T018, T019, T022
- `frontend/apps/mobile/src/app/(auth)/signin.tsx` — T004, T009–T017

### Parallel Opportunities

- **T008** (`Makefile`) is parallel with T006/T007 — different file, and the target may reference a script that does not exist yet as long as it exists before T025.
- **T024** (`docs/domain/auth-identity.md`) is parallel with all implementation.
- **Across stories**: with three developers, one takes US1's render gating (T009–T013), one takes US2's copy rewrite (T014–T017), one takes US3 (T021)—but all three touch `signin.tsx` or the check file, so in practice this feature is small enough that one person doing US1 → US2 → US3 in order is faster than coordinating the merge.

---

## Parallel Example

```bash
# The only genuinely parallel pair in this feature:
Task: "Add check:sso-availability to the test-frontend target in Makefile"
Task: "Update docs/domain/auth-identity.md with the SSO availability rule"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: baseline (T001)
2. Phase 2: the availability module (T002–T005) — **blocks everything**
3. Phase 3: hide what cannot work (T006–T013)
4. **STOP and VALIDATE**: run `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID= pnpm android`, confirm no Google button, no divider, no card
5. This alone satisfies SC-002 and most of SC-004 — the reviewer never reaches an alert because there is nothing to tap

### Incremental Delivery

1. Setup + Foundational → availability rule exists and is checked
2. + US1 → dead controls gone (MVP, ships on its own)
3. + US2 → the messages that survive are written for a person, and the check stops them regressing
4. + US3 → the engineer keeps the diagnostic they lost
5. Polish → domain doc, full gate, device sweep, Maestro

### Suggested Single-Developer Order

T001 → T002 → T003 → T006 (check the table before wiring it up) → T004 → T005 → T007 → T008
→ T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 → T020 →
T021 → T022 → T023 → T024 → T025 → T026 → T027 → T028.

---

## Notes

- **Scope discipline**: this feature removes surface. Resist adding a greyed-out state, a "why is this missing?" affordance, or a settings toggle — the spec's first assumption is that hiding beats disabling.
- **Do not rename `ssoButtonsRow`** despite the name being misleading (it is not a row). Unrelated churn in a file already being edited (research D5).
- **No new dependency, no new directory, no new package** — plan.md's Constitution V assessment depends on that staying true.
- `[P]` tasks touch different files with no ordering dependency.
- Commit after each task or logical group; the Definition of Done includes the `docs/domain/` update (T024), not as a follow-up.

---

## Implementation Notes (filled in during `/speckit-implement`)

Two design details in the task text could not be implemented as written. Both were resolved
in favour of the requirement the task was serving, and both are recorded here for review.

- **[ASSUMPTION: the `useSSOAvailability` hook lives in its own file,
  `frontend/apps/mobile/src/lib/use-sso-availability.ts`, not in `sso-availability.ts` as
  T005 and T021 specify.]** T002 also requires `sso-availability.ts` to be loadable by
  `node --experimental-strip-types`, and the two cannot both hold: the hook needs
  `import { Platform } from "react-native"`, and Node cannot parse React Native's
  Flow-typed `index.js` (`SyntaxError: Unexpected token 'typeof'`), so any runtime
  `react-native` import in the checked module breaks the check outright. Splitting the
  files keeps the decision table testable without a simulator, which is the property D1 and
  D4 exist to protect. `plan.md`'s Structure Decision already allows the hook to sit
  "in `signin.tsx` or in the hook beside the pure function".

- **[ASSUMPTION: `resolveSSOAvailability` returns `gaps: readonly SSOGap[]` — machine-readable
  tokens — rather than the `diagnostic: string | null` prose that data-model.md §2 specifies.
  The wording now lives inside the hook's `if (__DEV__) { … }` block.]** With the sentence
  built in the pure function, its text ships in every release bundle whether or not anything
  logs it: `expo export --platform android` followed by
  `grep -r "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID" dist/ | grep -v sourcemap` returned a match,
  because `__DEV__` guarded only the `console.warn` call and not the string it was given.
  Metro strips an `if (__DEV__)` block but does not tree-shake an unused module-level export,
  so the literals had to move inside the block. After the change the same grep returns nothing,
  which is what quickstart.md §4 asks for. The self-check still asserts the decision — on the
  gap tokens, which is data exactly as data-model.md §2 intended — and additionally reads
  `use-sso-availability.ts` as source text to assert that each gap's message still names the
  configuration value it is about, so the two halves cannot drift apart.

### Verification performed

| Requirement | How it was verified |
|---|---|
| FR-002, FR-003, FR-004 | iOS simulator + Android emulator screenshots: configured, Google-only, and neither-provider states. |
| FR-005 | Apple button gated on `apple`, which is false while the answer is `null`; no first-frame flash observed. |
| FR-010, FR-012 | Metro console showed exactly one warning naming the missing value per screen mount (1 → 2 across a navigate-away-and-back). |
| FR-011 | `expo export --platform android`; the diagnostic wording is absent from `dist/`, user-facing copy is present. |
| FR-013 | No token-exchange, request or navigation line differs from the pre-change file; the workspace-subdomain requirement and the Google consent sheet were exercised live. A fully credentialed Google/Apple sign-in was not completed — no provider account was available in this environment. |
| FR-014 | `check:sso-availability` fails, naming file and literal, when the deleted message is pasted back. |
| SC-006 | iPhone SE (3rd gen) and Android at 360 dp: both buttons full width, support text wraps, no overflow or leftover padding. |
| Regression | `.maestro/auth/signin.yaml` passes unchanged; lint problem count held at the 185 baseline. |

The Android "client identifier unset" case was reproduced by emptying `GOOGLE_ANDROID_CLIENT_ID`
in source rather than by starting Metro with `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=`: the
prebuilt dev-client APK carries the value natively, so a Metro-level override does not reach
the running app. `isPresent()` is the only consumer of that constant, so the code path
exercised is identical.
