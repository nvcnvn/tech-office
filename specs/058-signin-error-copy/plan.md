# Implementation Plan: Sign-In Errors Written for the Person Reading Them

**Branch**: `058-signin-error-copy` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/058-signin-error-copy/spec.md`

## Summary

Two alerts on the mobile email-and-password sign-in screen explain the app's build
configuration to the person holding the phone — one names an environment variable, the
other asks them to rebuild the app. Both are removed, and with them the interaction that
produces them: a sign-in provider that cannot work on this build is no longer rendered as a
button, so there is no tap to spend discovering it is dead.

The change is contained in one screen plus one new module. A pure
`resolveSSOAvailability()` in `frontend/apps/mobile/src/lib/sso-availability.ts` decides,
from the platform, the presence of the Google client identifier and the device's own answer
about Sign in with Apple, which providers to render — and, as data rather than a side
effect, what an engineer would need to be told about a missing one. A thin
`useSSOAvailability()` hook resolves the one asynchronous input, and emits that diagnostic
to `console.warn` under `__DEV__`, once per mount. Every remaining alert is rewritten to
name signing in with email and password as the way through. A new `.check.ts` in the
repository's existing self-check style walks the decision table and scans every string
literal in `src/app/(auth)/*.tsx` for build-configuration vocabulary, so the deleted
messages cannot come back quietly.

Nothing outside the mobile client moves: no proto, no RPC, no schema, no web page. Sign-in
for an available provider behaves exactly as it does today.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, React Native via Expo SDK 55

**Primary Dependencies**: `expo-router`, `expo-apple-authentication` (`isAvailableAsync`),
`expo-auth-session/providers/google` (`useIdTokenAuthRequest`), `react-hook-form`,
`@tech-office/theme-tokens`. No new dependency is added.

**Storage**: N/A — no persisted state. Existing MMKV keys (`auth.last_subdomain`,
`auth.last_email`) are untouched.

**Testing**: A Node self-check run as `pnpm --filter mobile check:sso-availability`
(`node --experimental-strip-types`, `node:assert/strict`), matching the four checks the
mobile app already ships; wired into `make test-frontend`. Manual device verification per
[quickstart.md](./quickstart.md). The existing Maestro flow
`.maestro/auth/signin.yaml` must keep passing unchanged.

**Target Platform**: iOS 16+ and Android 8+ through the Expo dev client and EAS release
builds. The screen also renders under Expo web, where both providers are correctly absent.

**Project Type**: Mobile client presentation change, single package
(`frontend/apps/mobile`).

**Performance Goals**: No new work on any render path. One `isAvailableAsync()` call per
screen mount, which the screen already makes — it moves from tap time to mount time, and
happens while the person is still reading the form.

**Constraints**: No flash of a control that is about to disappear (FR-005). The development
diagnostic must not survive into a release bundle (FR-011). Layout must hold at 360 dp
width and on an iPhone SE (SC-006).

**Scale/Scope**: One screen (~800 lines, of which roughly 60 change), one new ~90-line
module, one new ~120-line check, one `package.json` script, one `Makefile` line, one
domain-doc update.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v5.20.0 before Phase 0 and
re-evaluated after Phase 1 design. No violations, so the Complexity Tracking table below is
empty.*

| Principle | Applies? | Assessment |
|---|---|---|
| I. Data Governance & Multi-Tenancy | No | No schema, migration, query or tenant-scoped access is touched. |
| II. Scenario-First Integration & E2E Testing | Yes | The screen's behaviour is covered by a Node self-check over the decision table and the copy rule, plus the unchanged Maestro sign-in flow. Principle XIII explicitly sets a lighter bar for mobile and directs error states away from Maestro; the availability rule is a pure function precisely so it can be tested without a device. No backend behaviour changes, so no integration test is owed. |
| III. Two-Layer Service Architecture | No | No backend service, no proto-level authorization change. |
| IV. Cross-Domain Integration | No | No cross-domain call is added or removed. |
| V. Observability, Simplicity & YAGNI | Yes | The diagnostic is one `console.warn` behind `__DEV__` — the app's existing pattern — not a logging service. One new module and one new check are the whole footprint; no abstraction is introduced that has a single caller and no second one in sight. |
| VI. Versioning & Breaking Changes | Yes, trivially | Client-only copy and rendering change. No API contract moves, so there is nothing to version. |
| VII. Frontend API Wrapper Pattern & Type Safety | Yes | All API access stays inside the existing `apis` package wrappers (`exchangeTokenForOrganization`, `getOrganizationBySubdomain`, `getProfile`, `setAuthToken`); this feature adds no direct RPC call. `testID` props on the SSO buttons are preserved where the buttons survive. |
| VIII. Cross-Stack Constant Synchronization | No | No constant is shared across the stack. `GOOGLE_ANDROID_CLIENT_ID` is build configuration, read in one place, and stays there. |
| IX. UUID v7 & Cursor Pagination | No | Not applicable. |
| X. Structured Error Details | Yes, boundary case | Provider and network errors continue to surface their own message; this feature only adds the app's framing around it. No structured error detail is consumed or discarded. |
| XI. Distributed-First Architecture | No | Client-only. |
| XII. Living Documentation | Yes | `docs/domain/auth-identity.md` describes the mobile `signin` screen as "email + password + SSO"; it gains the availability rule and the rewritten failure messages in the same change set, per the Definition of Done. |
| XIII. Mobile Application Design & Testing | Yes | Feature scope is unchanged — this removes surface rather than adding any, so the carve-out list is not engaged. The change advances the principle's low-tech-user rule directly: an environment variable name in an alert box is the definition of jargon. `testID`s on surviving controls are unchanged; Maestro's happy-path flow is untouched because it never taps an SSO button. |

**Post-Phase-1 re-evaluation**: unchanged. The Phase 1 design added no new dependency, no
new persisted state and no new network call; the only additions to the repository are one
pure module, one check script and one script entry.

## Project Structure

### Documentation (this feature)

```text
specs/058-signin-error-copy/
├── plan.md              # This file
├── research.md          # Phase 0 output — where the alerts live, seven decisions
├── data-model.md        # Phase 1 output — input/output shapes and the decision table
├── quickstart.md        # Phase 1 output — how to prove it works
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

No `contracts/` directory. The feature exposes no interface to another system: no proto
service, no HTTP endpoint, no shared package export consumed outside this app. The one
contract worth writing down is the screen's rendering rule, and that is
[data-model.md §3](./data-model.md#3-decision-table), which the self-check enforces row by
row.

### Source Code (repository root)

```text
frontend/apps/mobile/
├── src/
│   ├── app/(auth)/
│   │   └── signin.tsx                    # MODIFIED — gate the SSO section on availability,
│   │                                     #   rewrite every alert, delete the two
│   │                                     #   build-configuration messages and the
│   │                                     #   unreachable non-iOS Apple branch
│   └── lib/
│       ├── sso-availability.ts           # NEW — resolveSSOAvailability() + useSSOAvailability()
│       └── sso-availability.check.ts     # NEW — decision table + auth-screen copy scan
└── package.json                          # MODIFIED — check:sso-availability script

Makefile                                  # MODIFIED — run the check in test-frontend
docs/domain/auth-identity.md              # MODIFIED — record the availability rule
```

**Structure Decision**: Mobile-only, and deliberately two files rather than one. The
decision logic lives in `src/lib/` next to `theme-resolution.ts`, `doc-rows.ts` and
`device-timezone.ts` — the existing home for pure logic with a paired `.check.ts` — because
that is what makes it testable in Node with no simulator. Everything that needs React or
Expo (the `useState`/`useEffect` wrapper, the `__DEV__` warn, the rendering) stays in
`signin.tsx` or in the hook beside the pure function. No new directory, no new package.

## Complexity Tracking

No constitution violations. Table intentionally empty.
