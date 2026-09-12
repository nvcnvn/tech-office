# Implementation Plan: Declare only the permissions the app actually uses

**Branch**: `053-ios-permission-declarations` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/053-ios-permission-declarations/spec.md`

## Summary

The shipped mobile binary declares five things the app does not use: two
background-location keys carrying `expo-location`'s own placeholder text, a
Face ID key for a sign-in that exists nowhere in the codebase, and a
development-only local-network pair. Each is independently a 5.1.1 rejection,
and the automated gate that should have caught them fails — which is why
`make test-mobile` cannot run at all (drift D64).

The fix removes each declaration **at its source** and then brings the
committed generated tree into agreement. Concretely: `expo-location` gains
`locationAlwaysPermission: false` and
`locationAlwaysAndWhenInUsePermission: false`; `expo-secure-store` gains
`faceIDPermission: false`; `android.blockedPermissions` gains the two biometric
permissions so their removal holds at manifest-merge time. `@expo/config-plugins`
treats a `false` permission option as *delete the key*, so these are genuine
source-level removals that survive regeneration — unlike the hand-edit that
produced the current state. The gate's allow-lists are then narrowed rather
than widened, it gains the ability to read purpose strings out of the committed
`Info.plist` (the one place the placeholder actually lives), and the
justification document and domain snapshots are brought into line.

No new dependency, no new script, no new Makefile target.

## Technical Context

**Language/Version**: JavaScript (Node 22, CommonJS) for the gate and the Expo
config plugins; JSON for `app.json`; XML plist and Android manifest for the
committed native trees. No TypeScript or Go is touched.

**Primary Dependencies**: Expo SDK config plugins (`expo-location`,
`expo-secure-store`, `@expo/config-plugins@55.0.7`). All already installed; the
feature adds none.

**Storage**: N/A — build-time configuration only. No schema, no migration.

**Testing**: `frontend/apps/mobile/scripts/check-store-manifest.js`, run through
`make check-store-manifest` and as a prerequisite of `make test-mobile`. The
gate is dependency-free and runs under bare `node`. Regeneration equivalence and
on-device prompt behaviour are one-time manual verifications documented in
[quickstart.md](quickstart.md).

**Target Platform**: iOS 16.4+ and Android, via Expo prebuild with a committed
native tree that EAS builds as-is.

**Project Type**: Mobile app configuration and its CI guard.

**Performance Goals**: The gate must stay cheap enough to sit in front of every
mobile test run — sub-second, no install step, no network. This rules out
running a full `expo prebuild` inside the gate.

**Constraints**: The committed `ios/` and `android/` trees must not be
regenerated wholesale — `plugins/with-ios-dev-client-bootstrap.js` patches the
Xcode project with a Metro-host build phase that an in-place
`expo prebuild --clean` would put at risk, and the churn would be out of all
proportion to a five-key fix. Regeneration is therefore verified against a
scratch copy and the committed tree is edited surgically.

**Scale/Scope**: Four production files (`app.json`, the committed `Info.plist`,
the committed `AndroidManifest.xml`, the gate) plus three documentation files.
Eight declared permissions in the target state — four per platform.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Assessment |
|---|---|---|
| I. Data Governance & Multi-Tenancy | No | No database, no tenant-scoped data. |
| II. Scenario-First Integration & E2E Testing | Partially | No RPC surface exists to integration-test. The analogue is the store-manifest gate, whose every check is specified ahead of implementation in [contracts/store-manifest-gate.md](contracts/store-manifest-gate.md), with scenario coverage in [contracts/test-scenarios.md](contracts/test-scenarios.md). The feature's headline outcome is that the Maestro suite becomes reachable again, which strengthens this principle rather than bypassing it. |
| III. Two-Layer Service Architecture | No | No backend service. |
| IV. Cross-Domain Integration | No | No cross-domain call. |
| V. Observability, Simplicity & YAGNI | **Yes** | Drives two decisions. The gate is extended by a handful of lines rather than gaining a prebuild-and-diff harness (R4), and no new string heuristic is added because the existing product-name rule already rejects the placeholder (R5). The gate's failure output already names every offending identifier, which is the observability this surface needs. |
| VI. Versioning & Breaking Changes | **Yes** | Removing a declared permission is a breaking change to the built artifact. It ships as one coordinated change set across configuration, native tree, gate and docs, which is how this project satisfies VI. No compatibility shim: a person who already granted a now-undeclared permission is simply never asked again. |
| VII. Frontend API Wrapper Pattern | No | No API call. |
| VIII. Cross-Stack Constant Synchronization | **Yes, by analogy** | The same identifier exists in four places — `app.json`, the committed native tree, the gate's allow-list, the justification document — and they must agree. The gate is the enforcement mechanism, exactly as SQL `CHECK` → Go → proto → TypeScript is elsewhere. [data-model.md](data-model.md) states the invariants; the state-transition section records what a future permission change must touch. |
| IX. UUID v7 & Cursor Pagination | No | |
| X. Structured Error Details | No | No RPC error surface. The gate's errors are CLI text, and the contract requires each to name the offending identifier verbatim. |
| XI. Distributed-First Architecture | No | |
| XII. Living Documentation | **Yes** | FR-017 requires `docs/domain/compliance-safety.md` to describe the gate as passing and D64 to be closed in `docs/domain/README.md`. `docs/compliance/permission-justifications.md` carries its own standing obligation to be updated in the same change set, and the gate mechanically enforces agreement between it and the allow-lists. Both are in scope, not follow-ups. |
| XIII. Mobile Design & Testing — Expo + Maestro | **Yes** | This feature restores `make test-mobile` as the suite's entry point. It adds no mobile UI, so the "every mobile UI has a Maestro flow" obligation is unchanged — but the reason that obligation has been unverifiable is precisely what is being fixed. |

**Result**: PASS. No violation, no entry in Complexity Tracking.

**Post-Phase-1 re-check**: PASS, unchanged. Phase 1 introduced no new file, no
new dependency and no new abstraction. The one addition to the gate — reading
purpose strings out of the committed `Info.plist` with a regular expression —
was weighed against a plist parsing dependency and rejected under principle V:
the generated dictionary is flat, and a dependency-free gate is what keeps it
cheap enough to gate every test run.

## Project Structure

### Documentation (this feature)

```text
specs/053-ios-permission-declarations/
├── plan.md                          # This file
├── spec.md                          # Feature specification
├── research.md                      # Phase 0 — where each declaration comes from, and why each fix is the fix
├── data-model.md                    # Phase 1 — the four representations, the target sets, the invariants
├── quickstart.md                    # Phase 1 — six-part verification procedure
├── contracts/
│   ├── store-manifest-gate.md       # Phase 1 — every check the gate must perform, after the change
│   └── test-scenarios.md            # Phase 1 — scenario → verification → requirement map
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
frontend/apps/mobile/
├── app.json                              # MODIFIED — the source of every removal
│                                         #   expo-location: locationAlwaysPermission: false,
│                                         #                  locationAlwaysAndWhenInUsePermission: false
│                                         #   expo-secure-store: → array form, faceIDPermission: false
│                                         #   android.blockedPermissions: + USE_BIOMETRIC, USE_FINGERPRINT
├── ios/TechOffice/Info.plist             # MODIFIED — delete the five keys; ATS dictionary untouched
├── android/app/src/main/AndroidManifest.xml  # MODIFIED — the two biometric lines become tools:node="remove"
├── plugins/
│   └── with-dev-local-network.js         # UNCHANGED — already correct; the committed tree predated it
├── scripts/
│   └── check-store-manifest.js           # MODIFIED — narrow three lists, forbid NSFaceIDUsageDescription,
│                                         #   run the purpose-string rules over the committed Info.plist
└── src/                                  # UNCHANGED — no runtime code is touched

docs/
├── compliance/permission-justifications.md   # MODIFIED — drop two sections, add three "absent/blocked" rows
└── domain/
    ├── compliance-safety.md                  # MODIFIED — gate described as passing
    └── README.md                             # MODIFIED — D64 removed from the drift register

Makefile                                      # UNCHANGED — test-mobile already depends on the gate
```

**Structure Decision**: The existing mobile-app layout is used as-is. The only
structural judgement in this feature is *which* of the four representations of
a permission is edited first, and the answer is always `app.json` — the
committed native tree is brought into agreement afterwards, never the other way
round. That ordering is what separates this change from the hand-edit that
created the defect, and it is recorded as a state-transition checklist in
[data-model.md](data-model.md) so the next permission change follows it.

## Implementation notes

Ordering matters in two places, and both are worth stating before tasks are
generated.

**The allow-list and the document must move together.** The gate asserts that
every `ALLOWED_IOS_KEYS` entry is present in `app.json` *and* mentioned in
`docs/compliance/permission-justifications.md`. Narrowing one without the other
leaves the gate red for the mirror image of today's reason. The Face ID key
comes out of `ALLOWED_IOS_KEYS` and goes into `FORBIDDEN_IOS_KEYS` in the same
edit, and the Face ID justification section is deleted in the same change set.

**`false`, not `undefined`, not `""`.** `applyPermissions` deletes a key only
when its option is strictly `false`; anything else falls through to
`option || existingInfoPlistValue || libraryDefault`, and that middle term is
why the hand-written Face ID string has survived every regeneration so far.
This is the single most load-bearing detail in the feature and is spelled out
in R1 of [research.md](research.md).

**What deliberately does not change**: `plugins/with-dev-local-network.js`, the
`Makefile`, `NSAppTransportSecurity.NSAllowsLocalNetworking` (an ATS setting,
not a declared permission — see R7), `ANDROID_PERMISSIONS_IGNORED`, and every
line of `src/`. The location and attachment flows behave identically before and
after.

## Complexity Tracking

> No Constitution Check violation. Table intentionally empty.
