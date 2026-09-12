# Phase 0 Research: Declare only the permissions the app actually uses

**Feature**: 053-ios-permission-declarations | **Date**: 2026-09-12

All findings below were verified against the working tree at HEAD, not recalled
from the spec. Where the spec stated an assumption, the verification that
confirms or corrects it is recorded here.

---

## R1 — Where each unwanted declaration actually comes from

**Question**: The spec says five declarations must go. For each, is it written
by hand, produced by a config plugin from its default, or merged in from a
dependency? The answer decides whether the fix is a config option, a blocked
permission, or a deletion.

**Method**: Read `frontend/apps/mobile/app.json`, every file in
`frontend/apps/mobile/plugins/`, the committed
`ios/TechOffice/Info.plist` and `android/app/src/main/AndroidManifest.xml`, the
compiled config plugins in `node_modules`, and
`git log -S` over the Android manifest.

**Findings**:

| Declaration | Present in `app.json`? | Present in committed native tree? | Origin |
|---|---|---|---|
| `NSLocationAlwaysUsageDescription` | no | yes, value `Allow $(PRODUCT_NAME) to access your location` | `expo-location` config plugin default, applied because `locationAlwaysPermission` is left `undefined` |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | no | yes, same value | same, `locationAlwaysAndWhenInUsePermission` left `undefined` |
| `NSFaceIDUsageDescription` | no | yes, value `Tech Office uses Face ID so you can sign in without typing your PIN each time.` | `expo-secure-store` config plugin, which declares the key whenever the plugin runs; the string is a hand-written override that predates the current tree |
| `NSLocalNetworkUsageDescription` + `NSBonjourServices` | no | yes, `Expo Dev Launcher …` / `["_expo._tcp"]` | written by `expo prebuild` in a dev-client context; the committed tree predates `plugins/with-dev-local-network.js` |
| `android.permission.USE_BIOMETRIC`, `android.permission.USE_FINGERPRINT` | no | yes, plain `<uses-permission>` with no `tools:node` | present since the initial public release commit; no installed dependency declares them in a library manifest |

**Decision**: The two location keys and the Face ID key are removed by passing
`false` to the plugin option that controls them. The dev-only pair is removed
from the committed prebuild only — its source is already correct, because
`plugins/with-dev-local-network.js` gates it behind `EXPO_LOCAL_DEV_NETWORK=1`.
The two Android biometric permissions are removed by adding them to
`android.blockedPermissions`.

**Rationale**: `@expo/config-plugins`' `applyPermissions` — the shared helper
both `expo-location` and `expo-secure-store` call through
`IOSConfig.Permissions.createPermissionsPlugin` — treats `false` specially:

```js
if (permissions[permission] === false) {
  delete infoPlist[permission];
} else {
  infoPlist[permission] = permissions[permission] || infoPlist[permission] || description;
}
```

So `false` is not "no override, fall back to the default"; it is "delete the
key". This is exactly the source-level removal FR-006 requires, and it is why
the fix is a plugin option rather than a hand-edit. Note the second branch:
`infoPlist[permission] || description` means a key already in the committed
`Info.plist` is *preserved* on the next prebuild if no option is given — which
is how the hand-written Face ID string has survived. `false` is the only value
that breaks that cycle.

**Alternatives considered**:

- *Delete the keys from `ios/TechOffice/Info.plist` and stop there.* Rejected,
  and named in the spec as the failure mode that produced the current state:
  `applyPermissions` re-adds the location keys from their defaults on the very
  next prebuild.
- *Override the keys in `app.json`'s `ios.infoPlist` with an empty string.* An
  empty string is falsy, so `applyPermissions` would fall through to the
  default. It also leaves the key declared, which is itself the 5.1.1 finding.
- *Remove `expo-secure-store` from the plugin list.* It would take the Face ID
  key with it, but also the Android backup and data-extraction rules that keep
  the stored session token out of device backups. Not a trade worth making for
  one Info.plist key.

---

## R2 — Are the spec's two load-bearing assumptions true?

**Question**: The spec asserts (a) no biometric sign-in exists, so removing the
declaration removes nothing, and (b) only foreground location is requested. If
either is false the correct fix inverts — keep the permission, write a real
purpose string.

**Method**: Grepped `frontend/apps/mobile/src/` for
`LocalAuthentication`, `biometric`, `Biometric`, `requireAuthentication`,
`requestForegroundPermissionsAsync`, `requestBackgroundPermissions`. Checked
`package.json` for a biometric authentication dependency.

**Findings**: Zero matches for every biometric term. `expo-local-authentication`
is not a dependency. Location is requested in exactly two places, both
foreground, both a single reading:

- `src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx:155`
- `src/app/(app)/(calendar)/[eventId].tsx:69`

**Decision**: Both assumptions hold. Proceed with removal. No feature is lost.

---

## R3 — Blocking a permission nothing declares

**Question**: The two Android biometric permissions are not in `app.json`'s
`permissions` array, so a clean prebuild would not emit them. Is adding them to
`blockedPermissions` doing anything, or is it cargo cult?

**Findings**: It does two distinct things. First, `blockedPermissions` makes
Expo emit `<uses-permission android:name="…" tools:node="remove"/>`, which
instructs the Android manifest merger to strip the permission even when a
dependency's own library manifest contributes it — this is FR-008, and it is
the only mechanism that acts at merge time rather than at prebuild time.
Second, the committed manifest declares them today; without the block, a
prebuild would drop them silently and nothing would record that the absence is
deliberate. `check-store-manifest.js` already skips any permission carrying
`tools:node="remove"`, so the blocked form passes the gate.

**Decision**: Add both to `android.blockedPermissions` and to the gate's
`BLOCKED_ANDROID_PERMISSIONS`, following the pattern already established for
`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`.

**Rationale**: The spec's own assumption calls for one pattern rather than two,
and the gate's `BLOCKED_ANDROID_PERMISSIONS` list is what turns "we removed it"
into "it cannot come back" — the list is asserted against `app.json`, so
deleting the block later fails the gate.

**Alternatives considered**: Leaving them out of both lists entirely. The
permission would be absent from a fresh prebuild, but a dependency that ships
`USE_BIOMETRIC` in its library manifest would merge it straight back in, and
the gate would then fail with "in neither the allowed nor the ignored set" —
correct, but only after it had already shipped in a build somebody made
locally.

---

## R4 — How to satisfy FR-007 without regenerating the whole native tree

**Question**: FR-007 requires the committed native tree to agree with what
regeneration produces. `npx expo prebuild --platform ios` in place would
rewrite the entire `ios/` directory, including the Xcode project that
`plugins/with-ios-dev-client-bootstrap.js` patches with a Metro-host build
phase. That is a far larger and riskier change than this feature asks for.

**Decision**: Regenerate into a scratch copy of the app, diff only the
permission-bearing entries, and bring the committed tree into agreement by
editing exactly those entries. Do not regenerate the committed tree in place.

**Rationale**: FR-007 is scoped in its own text to "declared permissions and
purpose strings", not to the whole tree. The spec's User Story 2 independent
test says the same thing: regenerate *into a scratch location* and compare. A
wholesale regeneration would churn the Xcode project, the Podfile lock, and the
generated Android Gradle files, none of which this feature is about, and would
risk losing the committed dev-client bootstrap patch.

**Alternatives considered**:

- *Full in-place `expo prebuild --clean`.* Produces the strongest guarantee and
  the worst diff. It also destroys `ios/TechOffice/GoogleService-Info.plist`
  placement and the bootstrap patch unless every plugin is idempotent under
  `--clean`, which is not established. Out of proportion to a five-key fix.
- *Write a script that automates the scratch regeneration and diff, and run it
  in the gate.* Rejected on YAGNI (Constitution V). The gate already asserts the
  forbidden keys against both `app.json` and the committed `Info.plist`
  independently, which is what actually catches a regression; a full
  prebuild in CI would cost minutes per run to re-derive a fact two cheap
  string checks already cover. The scratch regeneration stays a one-time
  verification step in `quickstart.md`.

---

## R5 — Does the gate already reject the placeholder purpose string? (FR-013)

**Question**: The spec assumes the existing string heuristic — minimum length,
required product name, banned development vocabulary — already rejects
`Allow $(PRODUCT_NAME) to access your location`, and says no new heuristic is
needed unless it passes.

**Findings**: The string is 45 characters, so it clears
`MIN_PERMISSION_STRING_LENGTH` (40). It fails
`/tech office/i` — `$(PRODUCT_NAME)` is an Xcode build-setting placeholder, not
the literal product name — so `checkPermissionString` reports it. The
assumption holds.

**Decision**: No new string heuristic. However, `checkPermissionString` today
runs only over `app.json` — over `ios.infoPlist` values and over plugin options
whose key ends in `Permission`. It never reads the strings in the committed
`Info.plist`, where this placeholder actually lives. That is why the gate
reports the two location keys as forbidden *keys* and says nothing about their
text.

**Decision (amended)**: Extend the gate's `Info.plist` pass to run
`checkPermissionString` over every `*UsageDescription` value it finds in the
committed plist. This is a handful of lines, it closes FR-013 for the place the
defect actually occurred, and it is the check that would have caught this
feature's bug on the day it was introduced.

**Rationale**: FR-013 says "the gate MUST fail when a purpose string is the
default text of the library that contributes it". Checking only `app.json`
satisfies that sentence for strings a human typed and misses it entirely for
strings a plugin default wrote — which is the whole population of interest.

---

## R6 — What the gate's allow-lists must become

**Findings**: Narrowing is mechanical once R1–R3 are settled.

| List | Remove | Add |
|---|---|---|
| `ALLOWED_IOS_KEYS` | `NSFaceIDUsageDescription` | — |
| `ALLOWED_ANDROID_PERMISSIONS` | `USE_BIOMETRIC`, `USE_FINGERPRINT` | — |
| `BLOCKED_ANDROID_PERMISSIONS` | — | `USE_BIOMETRIC`, `USE_FINGERPRINT` |
| `FORBIDDEN_IOS_KEYS` | — | `NSFaceIDUsageDescription` |

Adding `NSFaceIDUsageDescription` to `FORBIDDEN_IOS_KEYS` rather than merely
dropping it from the allowed set is what makes FR-012 true for the committed
`Info.plist`: the allowed-set check runs against `app.json` only, whereas the
forbidden-key check runs against both `app.json` and the committed plist.

**Coupling to watch**: the gate asserts every entry in `ALLOWED_IOS_KEYS` and
`ALLOWED_ANDROID_PERMISSIONS` appears in
`docs/compliance/permission-justifications.md`, and separately asserts every
`ALLOWED_IOS_KEYS` entry is present in `app.json`'s `ios.infoPlist`. So
narrowing the allow-lists and narrowing the document must land together or the
gate goes red for the mirror-image reason. This is the spec's last edge case.

---

## R7 — Is `NSAllowsLocalNetworking` in the committed ATS dictionary also dev-only?

**Question**: `ios/TechOffice/Info.plist` carries
`NSAppTransportSecurity.NSAllowsLocalNetworking = true` next to the two
dev-only keys the spec names. Should it go too?

**Findings**: It is an App Transport Security relaxation, not a permission: it
declares no capability, produces no consent prompt, and appears in no store
questionnaire. It permits cleartext to link-local addresses, which is what a
debug build needs to reach Metro, but it is also what `expo prebuild` writes by
default for every project and is not among the five findings the gate reports.

**Decision**: Leave it. [ASSUMPTION: `NSAllowsLocalNetworking` stays, because
the spec enumerates the dev-only removal as exactly the
`NSLocalNetworkUsageDescription` / `NSBonjourServices` pair, and this key is an
ATS setting rather than a declared permission — removing it would widen the
feature past its stated scope and is not needed for 5.1.1. If a later hardening
pass wants it gone, that is a distinct change with its own justification.]

---

## R8 — Returning the mobile suite to its normal entry point (FR-014)

**Findings**: `Makefile:289` reads
`test-mobile: check-store-manifest check-backend check-maestro check-maestro-env`.
Nothing is wrong with the wiring — `check-store-manifest` is a prerequisite, it
exits non-zero, and `make` stops. FR-014 needs no Makefile change; it is
satisfied the moment the gate passes.

**Decision**: Change nothing in the `Makefile`. Verify FR-014 by running
`make test-mobile` and observing it reach the Maestro suite. Record in
`docs/domain/compliance-safety.md` that the direct
`run-maestro-suite.sh` workaround is no longer needed.

---

## Summary of decisions

1. `app.json` — `expo-location` gains
   `locationAlwaysPermission: false` and
   `locationAlwaysAndWhenInUsePermission: false`.
2. `app.json` — `expo-secure-store` becomes an array form with
   `faceIDPermission: false`.
3. `app.json` — `android.blockedPermissions` gains `USE_BIOMETRIC` and
   `USE_FINGERPRINT`.
4. `ios/TechOffice/Info.plist` — delete the five keys, keeping the ATS
   dictionary intact.
5. `android/app/src/main/AndroidManifest.xml` — the two biometric
   `<uses-permission>` lines become `tools:node="remove"` form.
6. `check-store-manifest.js` — narrow three lists, add
   `NSFaceIDUsageDescription` to the forbidden set, and run the purpose-string
   heuristic over the committed `Info.plist`.
7. `docs/compliance/permission-justifications.md` — remove two justification
   sections, add three "deliberately absent / blocked" rows.
8. `docs/domain/compliance-safety.md` and `docs/domain/README.md` — gate
   described as passing, D64 closed.

No new dependency, no new script, no new Makefile target.
