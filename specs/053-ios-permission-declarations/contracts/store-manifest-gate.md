# Contract: the store-manifest gate

**Feature**: 053-ios-permission-declarations

`frontend/apps/mobile/scripts/check-store-manifest.js` is the only interface
this feature exposes. It is a CLI check with no arguments, invoked as
`node scripts/check-store-manifest.js` or via `make check-store-manifest`, and
it is a prerequisite of `make test-mobile`.

This document is the contract the gate must satisfy after the change: its
inputs, its exit behaviour, and every check it performs. It is written so the
implementation can be verified against it line by line.

---

## Invocation

```text
node frontend/apps/mobile/scripts/check-store-manifest.js
```

No flags, no environment variables, no network. Runs from any working
directory; paths are resolved relative to the script.

## Inputs

| Path | Required | If missing |
|---|---|---|
| `frontend/apps/mobile/app.json` | yes | throws — the check cannot be meaningful without it |
| `frontend/apps/mobile/android/app/src/main/AndroidManifest.xml` | no | emits a `note:` saying coverage is partial and continues |
| `frontend/apps/mobile/ios/TechOffice/Info.plist` | no | emits a `note:` saying coverage is partial and continues |
| `docs/compliance/permission-justifications.md` | yes | a failure |

The two optional inputs exist only after `expo prebuild`. In this repository
both are committed, so both are always read; the graceful degradation is for a
tree where they have been cleaned. Partial coverage is announced rather than
silently passed — this is the spec's "gate is run before the native projects
have been generated" edge case, and the existing behaviour already satisfies
it. No change needed.

## Output and exit code

| Condition | stdout | stderr | exit |
|---|---|---|---|
| No failures | `store manifest check passed`, preceded by any `note:` lines | — | `0` |
| One or more failures | any `note:` lines | `store manifest check FAILED (N problems):` then one `  - message` per failure | `1` |

Every failure message MUST name the offending key or permission verbatim, so
that `grep`-ing the output for an identifier is a reliable test (SC-007 is
verified exactly this way).

---

## Checks

### Group 1 — the Expo source configuration (`app.json`)

| # | Check | Failure message shape |
|---|---|---|
| 1.1 | No `FORBIDDEN_IOS_KEYS` entry appears in `ios.infoPlist` | `app.json declares {key}, which must not ship.` |
| 1.2 | Every `*UsageDescription` key in `ios.infoPlist` is in `ALLOWED_IOS_KEYS` | `app.json declares an unexpected iOS permission {key}.` |
| 1.3 | Every `ALLOWED_IOS_KEYS` entry is present in `ios.infoPlist` | `app.json is missing {key}` |
| 1.4 | Every `*UsageDescription` value passes the purpose-string rules | see Group 4 |
| 1.5 | `ios.infoPlist.ITSAppUsesNonExemptEncryption === false` | `app.json must set … to false` |
| 1.6 | Every `android.permissions` entry is in `ALLOWED_ANDROID_PERMISSIONS` | `app.json declares an unexpected Android permission {permission}.` |
| 1.7 | Every `REQUIRED_ANDROID_PERMISSIONS` entry is in `android.permissions` | `app.json is missing {permission}.` |
| 1.8 | Every `BLOCKED_ANDROID_PERMISSIONS` entry is in `android.blockedPermissions` | `app.json must block {permission}` |
| 1.9 | Every plugin option whose key ends in `Permission` and whose value is a string passes the purpose-string rules | see Group 4 |
| 1.10 | The `expo-location` plugin sets neither `isAndroidBackgroundLocationEnabled` nor `isIosBackgroundLocationEnabled` truthy | `expo-location must not enable background location` |

Checks 1.1–1.10 all exist today. Only the contents of the four sets change.

**Note on 1.9**: a plugin option set to `false` — which is how this feature
removes the Face ID and background-location keys — is not a string, so it is
skipped rather than failed. That is the correct behaviour and requires no
change, but it is load-bearing: were `false` treated as a permission string it
would fail the length rule.

### Group 2 — the committed Android manifest

| # | Check | Failure message shape |
|---|---|---|
| 2.1 | Every declared `<uses-permission>` that is not `tools:node="remove"` is in `ALLOWED_ANDROID_PERMISSIONS` or `ANDROID_PERMISSIONS_IGNORED` | `AndroidManifest.xml declares {permission}, which is in neither the allowed nor the ignored set.` |
| 2.2 | No `BLOCKED_ANDROID_PERMISSIONS` entry is declared without `tools:node="remove"` | `AndroidManifest.xml still declares {permission} despite blockedPermissions.` |
| 2.3 | Every `REQUIRED_ANDROID_PERMISSIONS` entry is declared | `AndroidManifest.xml is missing {permission}` |

Unchanged. After this feature, 2.1 and 2.2 together are what enforce FR-008 for
the two biometric permissions: whether they arrive from the app's own
declaration or from a dependency's merged library manifest, the only form that
passes is the `tools:node="remove"` form.

### Group 3 — the committed iOS Info.plist

| # | Check | Status | Failure message shape |
|---|---|---|---|
| 3.1 | No `FORBIDDEN_IOS_KEYS` entry appears | existing | `Info.plist declares {key}, which must not ship` |
| 3.2 | `ITSAppUsesNonExemptEncryption` is present | existing | `Info.plist is missing ITSAppUsesNonExemptEncryption.` |
| 3.3 | Every `*UsageDescription` key present is in `ALLOWED_IOS_KEYS` | **new** | `Info.plist declares an unexpected iOS permission {key}.` |
| 3.4 | Every `*UsageDescription` value passes the purpose-string rules | **new** | see Group 4 |

3.3 and 3.4 are the new coverage this feature adds, and they are the checks
that would have caught the original defect: the placeholder string
`Allow $(PRODUCT_NAME) to access your location` lives only in the committed
plist, which the gate has never read for content. 3.4 closes FR-013 where it
actually matters.

Parsing: the plist is read as text, not through a plist library. Extracting
`<key>NAME</key>` followed by `<string>VALUE</string>` with a regular
expression is sufficient for the flat top-level dictionary Expo generates, and
keeps the gate dependency-free — it runs under bare `node` with no install
step, which is what lets `make check-store-manifest` be cheap enough to sit in
front of every mobile test run. Keys whose value is not a `<string>` (for
example `NSBonjourServices`, an array) are matched by 3.1 on the key alone and
are not candidates for 3.3 or 3.4.

### Group 4 — the purpose-string rules

Applied by `checkPermissionString(where, value)`. A string fails if any of:

| Rule | Constant | Rationale |
|---|---|---|
| Not a string | — | a malformed config is a failure, not a skip |
| Contains a development-only phrase | `DEVELOPMENT_ONLY_PHRASES` | reveals a string written for an engineer |
| Contains internal vocabulary | `INTERNAL_VOCABULARY` | a reviewer cannot parse the product's private words |
| Shorter than 40 characters | `MIN_PERMISSION_STRING_LENGTH` | too short to name a feature |
| Does not match `/tech office/i` | — | a framework default uses `$(PRODUCT_NAME)`, never the literal name; this is the rule that rejects the placeholder |

Unchanged. The `where` argument identifies the source so the message is
actionable; for Group 3 it takes the form `Info.plist {key}`.

### Group 5 — document agreement

| # | Check | Failure message shape |
|---|---|---|
| 5.1 | `docs/compliance/permission-justifications.md` exists | `… is missing` |
| 5.2 | It contains every `ALLOWED_IOS_KEYS` entry as a substring | `… does not mention {key}.` |
| 5.3 | It contains every `ALLOWED_ANDROID_PERMISSIONS` entry as a substring | `… does not mention {permission}.` |

Unchanged in logic. Because the document currently contains
`NSFaceIDUsageDescription`, `USE_BIOMETRIC` and `USE_FINGERPRINT` as sections
and will keep mentioning the latter two in the "deliberately blocked" table,
5.2 and 5.3 remain satisfied by construction — they assert presence, never
absence. Absence is asserted by 1.1/3.1 for iOS and 1.8/2.2 for Android.

---

## The four sets, after this feature

```js
const ALLOWED_IOS_KEYS = new Set([
  "NSMicrophoneUsageDescription",
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSLocationWhenInUseUsageDescription",
]);

const ALLOWED_ANDROID_PERMISSIONS = new Set([
  "android.permission.RECORD_AUDIO",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
]);

const BLOCKED_ANDROID_PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
];

const FORBIDDEN_IOS_KEYS = [
  "NSLocationAlwaysUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSFaceIDUsageDescription",
  "NSLocalNetworkUsageDescription",
  "NSBonjourServices",
];
```

`REQUIRED_ANDROID_PERMISSIONS` and `ANDROID_PERMISSIONS_IGNORED` are unchanged.

---

## The `app.json` contract

The gate reads, and this feature changes, exactly these regions:

```jsonc
"android": {
  "permissions": [ /* unchanged, four entries */ ],
  "blockedPermissions": [
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.USE_BIOMETRIC",     // new
    "android.permission.USE_FINGERPRINT"    // new
  ]
},
"plugins": [
  ["expo-secure-store", { "faceIDPermission": false }],   // was the bare string "expo-secure-store"
  ["expo-location", {
    "locationWhenInUsePermission": "…unchanged…",
    "locationAlwaysPermission": false,                    // new
    "locationAlwaysAndWhenInUsePermission": false,        // new
    "isAndroidBackgroundLocationEnabled": false,
    "isIosBackgroundLocationEnabled": false
  }]
]
```

`ios.infoPlist` is unchanged: it already declares exactly the four allowed keys
and nothing else.

`false` is the meaningful value here, not `undefined` and not `""`.
`@expo/config-plugins`' `applyPermissions` deletes a key when its option is
strictly `false`, and otherwise falls back to `options[key] || infoPlist[key] ||
default` — which preserves whatever is already in the committed plist. `false`
is the only value that removes a key and keeps it removed across regenerations.

---

## The development opt-in contract (FR-009)

`plugins/with-dev-local-network.js` is unchanged by this feature. Its contract,
restated so the implementation does not disturb it:

| `EXPO_LOCAL_DEV_NETWORK` | Effect on the generated `Info.plist` |
|---|---|
| `"1"` | `NSLocalNetworkUsageDescription` = `Tech Office connects to a local development server while debugging.`, `NSBonjourServices` = `["_http._tcp"]` |
| anything else, or unset | neither key is written |

The keys it injects would fail the gate's `FORBIDDEN_IOS_KEYS` check if they
reached a committed tree — which is the intended outcome. An engineer who opts
in produces local modifications to `ios/TechOffice/Info.plist` that must not be
committed; the gate is what catches it if they are. This friction is real and
is documented in `quickstart.md` rather than engineered away.
