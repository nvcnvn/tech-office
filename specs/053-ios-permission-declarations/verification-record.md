# Verification record: feature 053

The one-time verifications this feature's tasks ask to be "recorded in the PR
description". This implementation ran unattended, with no PR open, so the
record lives here instead.

[ASSUMPTION: the tasks say "record in the PR description". There was no PR to
write into, and a record that exists only in a terminal transcript is not
reviewable, so it is committed alongside the spec artifacts. Copy it into the
PR body when one is opened.]

## T001 — baseline, before any edit

`node frontend/apps/mobile/scripts/check-store-manifest.js` → exit 1, five
problems, exactly as drift D64 described:

```text
store manifest check FAILED (5 problems):

  - app.json is missing NSFaceIDUsageDescription; every permission the app requests must explain itself.
  - Info.plist declares NSLocationAlwaysUsageDescription, which must not ship (FR-027/FR-029).
  - Info.plist declares NSLocationAlwaysAndWhenInUseUsageDescription, which must not ship (FR-027/FR-029).
  - Info.plist declares NSLocalNetworkUsageDescription, which must not ship (FR-027/FR-029).
  - Info.plist declares NSBonjourServices, which must not ship (FR-027/FR-029).
```

## T003 — `false` deletes the key

`frontend/node_modules/.pnpm/@expo+config-plugins@55.0.7/node_modules/@expo/config-plugins/build/ios/Permissions.js`,
version **55.0.7**. `applyPermissions`, lines 29–37:

```js
for (const [permission, description] of entries) {
  if (permissions[permission] === false) {
    delete infoPlist[permission];                                             // line 32
  } else {
    infoPlist[permission] = permissions[permission] || infoPlist[permission] || description;  // line 34
  }
}
```

Line 32 is the deletion; line 34 is the `options[key] || infoPlist[key] ||
default` fallback whose middle term preserved the hand-written
`NSFaceIDUsageDescription` across every past regeneration. Strict `false` is
the only value that removes a key.

The option names map to plist keys in each library's own plugin:
`expo-secure-store`'s `withSecureStore` passes `faceIDPermission` as
`NSFaceIDUsageDescription`; `expo-location`'s `withLocation` passes
`locationAlwaysPermission` and `locationAlwaysAndWhenInUsePermission` as the
two `NSLocationAlways*` keys. Both call
`IOSConfig.Permissions.createPermissionsPlugin`, so both go through the code
above.

## T012–T015 — regeneration equivalence (G1–G4)

Method: a scratch project at `frontend/apps/053-prebuild-check` — `app.json`,
`package.json`, the two Google service files, and symlinks to `node_modules`,
`assets`, `plugins`, `app` and `src` — then `npx expo prebuild --no-install`
with no `ios/` or `android/` present.

[ASSUMPTION: quickstart part 3 says to `cp -R` the whole app to `/tmp`. That
copy is ~4 GB (four committed `.ipa` files, a 30 MB build log, `ios/Pods`,
`ios/build`) and its pnpm `node_modules` symlinks — `../../../node_modules/.pnpm/…`
— break outside the workspace, so the prebuild could not have resolved a single
plugin. A symlinked scratch project at the same directory depth keeps those
relative symlinks valid and takes seconds. Nothing in the procedure depends on
the copy being deep.]

**G1 / T012 — the scratch `Info.plist` after regeneration** (`plutil -p`):

```text
"NSCameraUsageDescription"           => "Tech Office uses your camera to take photos to attach to messages, tasks and job records."
"NSLocationWhenInUseUsageDescription"=> "Tech Office uses your location to confirm you are at the job site when you check in or complete a task. It is only used while the app is open."
"NSMicrophoneUsageDescription"       => "Tech Office uses your microphone for voice calls and voice messages with your colleagues."
"NSPhotoLibraryUsageDescription"     => "Tech Office needs access to your photos so you can attach them to messages, tasks and job records."
```

Exactly four. None of the five forbidden keys. `NSAppTransportSecurity.NSAllowsLocalNetworking`
is still `true` and is untouched — an ATS setting, not a declared permission (R7).

**G2 / T013 — committed vs. regenerated**: the four `*UsageDescription`
key/value pairs are identical in both directions; no key and no value differs.
The committed plist needed no reconciliation.

**G3 / T014 — the scratch `AndroidManifest.xml`**: byte-identical
`uses-permission` block to the committed manifest, including
`USE_BIOMETRIC` and `USE_FINGERPRINT` carrying `tools:node="remove"`.

**G4 / T015 — the development opt-in, both ways**:

| Run | Result |
|---|---|
| `EXPO_LOCAL_DEV_NETWORK=1 npx expo prebuild --platform ios --no-install` | `NSLocalNetworkUsageDescription` = `Tech Office connects to a local development server while debugging.`, `NSBonjourServices` = `["_http._tcp"]` |
| `npx expo prebuild --platform ios --no-install` | neither key present |

**The defect this step found**, and the deviation it forced — see
[the deviation section](#deviation-pluginswith-dev-local-networkjs-had-to-change).

The scratch project was deleted afterwards;
`git status --short frontend/apps/mobile/ios` shows only the intended
`Info.plist` change (T016).

## T025 — the gate bites on all ten reintroductions (N1–N10)

Each edit applied to a snapshot of the post-change tree, the gate run, then the
snapshot restored. All ten exit 1 and name the identifier.

| ID | exit | The line that names it |
|---|---|---|
| N1 | 1 | `app.json declares NSLocationAlwaysUsageDescription, which must not ship. See FR-001/FR-002/FR-003.` |
| N2 | 1 | `Info.plist declares NSLocationAlwaysUsageDescription, which must not ship (FR-001/FR-002/FR-003).` |
| N3 | 1 | `app.json declares NSLocationAlwaysAndWhenInUseUsageDescription, which must not ship…` |
| N4 | 1 | `Info.plist declares NSLocationAlwaysAndWhenInUseUsageDescription, which must not ship…` |
| N5 | 1 | `app.json plugin expo-secure-store must set faceIDPermission to false; any other value — including leaving it out — makes the build declare NSFaceIDUsageDescription, which must not ship.` |
| N6 | 1 | `Info.plist declares NSFaceIDUsageDescription, which must not ship…` |
| N7 | 1 | `Info.plist declares NSLocalNetworkUsageDescription…` **and** `Info.plist declares NSBonjourServices…` |
| N8 | 1 | `app.json declares an unexpected Android permission android.permission.USE_BIOMETRIC.` |
| N9 | 1 | `app.json must block android.permission.USE_BIOMETRIC: it arrives transitively and nothing in the app uses it.` |
| N10 | 1 | `Info.plist NSLocationWhenInUseUsageDescription should name the app so the prompt reads as a sentence: "Allow $(PRODUCT_NAME) to access your location"` |

N10 is this feature's own regression test: the exact placeholder that shipped,
in the exact file where it shipped, rejected by the product-name rule through
the new check 3.4. After restoring the snapshot the gate exits 0 again.

**N5 required a gate addition that the contract did not specify.** See
[the second deviation](#deviation-the-gate-needed-a-plugin-option-check-for-n5).

## T024 — `make test-mobile` reaches the suite

```text
=== Checking mobile store manifest ===
store manifest check passed
Checking backend at http://localhost:18080... ✓ up
✓ maestro (2.10.0)
✓ maestro env loaded

=== Running all Maestro flows ===
frontend/apps/mobile/scripts/run-maestro-suite.sh
==> Running signin-known-device.yaml
```

The gate is cleared and `make` proceeds through `check-backend`,
`check-maestro`, `check-maestro-env` into `run-maestro-suite.sh`, which is what
FR-014 and SC-006 ask for. The run then fails inside
`dev-client-bootstrap.yaml` on `Assert that id: xmark is visible` — a flow-level
failure in the dev-client launcher bootstrap, on the installed dev-client build,
which this feature does not touch. Out of scope here by T024's own wording, but
worth someone's attention.

---

## Deviation: `plugins/with-dev-local-network.js` had to change

The plan lists this file as **unchanged**, on the understanding that it is the
only source of the local-network keys and is already correctly gated. The
regeneration check (T012) falsified that: a from-scratch prebuild with
`EXPO_LOCAL_DEV_NETWORK` unset still produced

```text
"NSBonjourServices"                  => ["_expo._tcp"]
"NSLocalNetworkUsageDescription"     => "Expo Dev Launcher uses the local network to discover and connect to development servers running on your computer."
```

The source is `expo-dev-launcher`'s own config plugin
(`expo-dev-launcher@55.0.23/plugin/src/withDevLauncher.ts`), autolinked through
the `expo-dev-client` dependency. Its `withLocalNetworkPermission` writes both
keys **unconditionally on every prebuild**, and it compensates with
`withStripLocalNetworkKeysForRelease`, an Xcode build phase that deletes them
again when `$CONFIGURATION != Debug`.

That compensation is too late for this repository. The `ios/` tree is committed
and EAS builds it as-is; the store-manifest gate reads the committed
`Info.plist`, not a build product. So with the plugin left alone, FR-003 holds
only for a Release *build*, while FR-006 and FR-007 — regeneration reproduces
the removal, and the committed tree equals what regeneration produces — are
both false, and the very next `expo prebuild` reintroduces two keys the gate
rejects.

`with-dev-local-network.js` already owns exactly this concern and already runs
after the dev-launcher plugin (verified empirically). It now deletes both keys
when `EXPO_LOCAL_DEV_NETWORK` is not `1`, and writes the app's own strings when
it is, instead of writing when set and doing nothing otherwise. The opt-in
contract in `contracts/store-manifest-gate.md` is unchanged in observable
behaviour — the table in G4 above is exactly what it specifies.

The alternative was to accept the keys in the committed tree and rely on the
build phase, which contradicts FR-003, FR-006, FR-007 and leaves the gate red.

## Deviation: the gate needed a plugin-option check for N5

Scenario N5 reintroduces Face ID by setting `faceIDPermission` back to a real
string, and the contract expects the gate to fail naming
`NSFaceIDUsageDescription`. It would not have: the gate's forbidden-key check
reads `expo.ios.infoPlist`, and a plugin option is not a plist key. The
purpose-string rules (check 1.9) would have *passed* a well-written Face ID
string.

FR-012 requires the gate to fail when a forbidden permission is reintroduced
"in the source configuration **or** in the committed generated build", so this
is a gap in the gate, not in the scenario. `check-store-manifest.js` now
asserts that three plugin options are present and strictly `false`:

| Plugin | Option | Key it would otherwise declare |
|---|---|---|
| `expo-secure-store` | `faceIDPermission` | `NSFaceIDUsageDescription` |
| `expo-location` | `locationAlwaysPermission` | `NSLocationAlwaysUsageDescription` |
| `expo-location` | `locationAlwaysAndWhenInUsePermission` | `NSLocationAlwaysAndWhenInUseUsageDescription` |

Absence is failed as well as a wrong value, because `applyPermissions` falls
back to the library's default description when the option is missing — deleting
the line is exactly as bad as setting a string.

## Not performed: T035 and T036, the device passes

Both require building from the production configuration, installing on a fresh
iOS simulator/device and a fresh Android install, exercising the four capability
flows and counting system consent dialogs by eye. No automated harness in this
repository observes OS permission sheets — Maestro drives the app's own UI — and
this implementation ran unattended, so neither was done.

They remain open against SC-001, US1-3 and US1-4. What is already established
without them: the declared set is exactly four keys on iOS and four permissions
on Android, in `app.json`, in both committed native trees, and in what a
from-scratch regeneration produces.
