# Phase 1 Data Model: Declare only the permissions the app actually uses

**Feature**: 053-ios-permission-declarations | **Date**: 2026-09-12

This feature has no database schema, no proto message and no runtime state. Its
"data" is build-time configuration that exists in four files which must agree
with one another. This document defines the entities the spec names, where each
physically lives, and the invariants the automated gate enforces between them.

---

## Entities

### Declared permission

A capability the built app tells the operating system it may request.

| Field | Type | Notes |
|---|---|---|
| `platform` | `ios` \| `android` | |
| `identifier` | string | iOS: an `Info.plist` key such as `NSCameraUsageDescription`. Android: a permission name such as `android.permission.RECORD_AUDIO`. |
| `purpose_string` | string, iOS only | The sentence shown at the prompt. Android permissions carry no per-app string. |
| `state` | `declared` \| `blocked` \| `absent` | `blocked` means declared with `tools:node="remove"` so the manifest merger strips it; Android only. |

**Representations** — the same permission exists in up to four places, and the
gate's job is to keep them consistent:

| Place | Path | Role |
|---|---|---|
| Source configuration | `frontend/apps/mobile/app.json` | Authoritative. Everything else is derived from it. |
| Config plugin option | `frontend/apps/mobile/app.json` `expo.plugins[]` | Where a library-contributed permission is turned on or off. `false` deletes the key. |
| Committed generated build | `frontend/apps/mobile/ios/TechOffice/Info.plist`, `frontend/apps/mobile/android/app/src/main/AndroidManifest.xml` | What the build service actually compiles. Must equal what regeneration produces. |
| Allow-list | `frontend/apps/mobile/scripts/check-store-manifest.js` | The gate's record of what is permitted. |
| Justification | `docs/compliance/permission-justifications.md` | Submission-ready prose, one entry per declared permission. |

### Purpose string

The sentence a person reads when asked for a capability.

| Rule | Enforced by |
|---|---|
| At least 40 characters | `MIN_PERMISSION_STRING_LENGTH` |
| Contains the literal product name "Tech Office" | `/tech office/i` test |
| Contains none of `development server`, `debugging`, `localhost`, `metro`, `test`, `todo`, `lorem` | `DEVELOPMENT_ONLY_PHRASES` |
| Contains none of `ritual`, `employee_id`, `rpc`, `tenant` | `INTERNAL_VOCABULARY` |

A library default fails the product-name rule, because Expo's defaults use the
Xcode build-setting placeholder `$(PRODUCT_NAME)` rather than the literal name.
This is the mechanism by which FR-013 is satisfied without a new heuristic.

### Allow-list

The gate's record of what is permitted. Four sets, each with a distinct job:

| Set | Semantics | Checked against |
|---|---|---|
| `ALLOWED_IOS_KEYS` | Every entry MUST be present in `app.json` and MUST be justified in the document; anything else in `app.json` fails. | `app.json` `ios.infoPlist`, the justification document |
| `FORBIDDEN_IOS_KEYS` | MUST NOT appear anywhere. | `app.json` `ios.infoPlist` **and** the committed `Info.plist` |
| `ALLOWED_ANDROID_PERMISSIONS` | The permitted set; entries MUST be justified in the document. | `app.json` `android.permissions`, the committed `AndroidManifest.xml` |
| `BLOCKED_ANDROID_PERMISSIONS` | MUST appear in `app.json` `android.blockedPermissions`, and MUST NOT appear un-removed in the committed manifest. | `app.json`, the committed `AndroidManifest.xml` |

The asymmetry matters: an allow-list entry is checked against the *source
configuration* only, while a forbidden-key entry is checked against the source
*and* the committed generated build. A key that must not ship therefore belongs
in `FORBIDDEN_IOS_KEYS`, not merely outside `ALLOWED_IOS_KEYS`.

### Justification entry

One written explanation per declared permission, in submission-ready prose. The
gate asserts only presence — that the document contains each allowed
identifier as a literal substring — not content. Two tables at the foot of the
document record deliberate absences; the gate does not read them, but their
purpose is to answer the next person who wonders why a permission is missing.

---

## Target state

### iOS — declared (exactly four, FR-005)

| Key | Purpose string |
|---|---|
| `NSMicrophoneUsageDescription` | Tech Office uses your microphone for voice calls and voice messages with your colleagues. |
| `NSCameraUsageDescription` | Tech Office uses your camera to take photos to attach to messages, tasks and job records. |
| `NSPhotoLibraryUsageDescription` | Tech Office needs access to your photos so you can attach them to messages, tasks and job records. |
| `NSLocationWhenInUseUsageDescription` | Tech Office uses your location to confirm you are at the job site when you check in or complete a task. It is only used while the app is open. |

All four strings are unchanged by this feature; they already pass every rule.

### iOS — forbidden (must appear nowhere)

| Key | Why |
|---|---|
| `NSLocationAlwaysUsageDescription` | FR-001. No background location is ever requested. |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | FR-001. |
| `NSFaceIDUsageDescription` | FR-002. No biometric sign-in exists. |
| `NSLocalNetworkUsageDescription` | FR-003. Development only; injected behind `EXPO_LOCAL_DEV_NETWORK=1`. |
| `NSBonjourServices` | FR-003. |

`NSFaceIDUsageDescription` moves from `ALLOWED_IOS_KEYS` to
`FORBIDDEN_IOS_KEYS` — it is not simply dropped, because dropping it would
leave the committed `Info.plist` unchecked for it.

### Android — declared (exactly four, FR-005)

`android.permission.RECORD_AUDIO`, `ACCESS_COARSE_LOCATION`,
`ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`. Unchanged by this feature.

### Android — blocked (five after this feature)

| Permission | Change |
|---|---|
| `android.permission.SYSTEM_ALERT_WINDOW` | unchanged |
| `android.permission.READ_EXTERNAL_STORAGE` | unchanged |
| `android.permission.WRITE_EXTERNAL_STORAGE` | unchanged |
| `android.permission.USE_BIOMETRIC` | **new** — moves out of the allowed set |
| `android.permission.USE_FINGERPRINT` | **new** — moves out of the allowed set |

### Android — ignored (unchanged)

`ANDROID_PERMISSIONS_IGNORED` lists permissions the OS or a build tool always
adds and that carry no prompt. This feature does not touch it. In particular
`FOREGROUND_SERVICE` stays ignored: it is contributed by the notification and
call stack, not by location, and `expo-location` adds
`FOREGROUND_SERVICE_LOCATION` only when background location is enabled — which
`app.json` already disables on both platforms.

---

## Invariants

These are the properties that must hold after the change, stated so a reviewer
can check each one independently.

- **I1 (FR-005)**: The set of iOS `*UsageDescription` keys in the committed
  `Info.plist` equals `ALLOWED_IOS_KEYS` exactly.
- **I2 (FR-005)**: The set of un-removed `<uses-permission>` entries in the
  committed `AndroidManifest.xml`, minus `ANDROID_PERMISSIONS_IGNORED`, equals
  `ALLOWED_ANDROID_PERMISSIONS` exactly.
- **I3 (FR-001..003, FR-012)**: No entry of `FORBIDDEN_IOS_KEYS` appears in
  either `app.json` or the committed `Info.plist`.
- **I4 (FR-004, FR-013)**: Every purpose string in `app.json` *and* in the
  committed `Info.plist` satisfies every Purpose-string rule above.
- **I5 (FR-006)**: Regenerating from `app.json` into a scratch location
  produces an `Info.plist` whose `*UsageDescription` key set equals I1's.
- **I6 (FR-007)**: The permission-bearing entries of the scratch regeneration
  and of the committed tree are identical, in both directions.
- **I7 (FR-008)**: Each `BLOCKED_ANDROID_PERMISSIONS` entry appears in
  `app.json` `android.blockedPermissions`, and appears in the committed
  manifest only in `tools:node="remove"` form, if at all.
- **I8 (FR-009)**: With `EXPO_LOCAL_DEV_NETWORK=1`, regeneration yields
  `NSLocalNetworkUsageDescription` and `NSBonjourServices`; without it, neither.
- **I9 (FR-015)**: `ALLOWED_IOS_KEYS` ∪ `ALLOWED_ANDROID_PERMISSIONS` is
  exactly the set of identifiers the justification document explains, and the
  document explains nothing outside it.
- **I10 (FR-010, FR-014)**: `node scripts/check-store-manifest.js` exits 0, and
  `make test-mobile` reaches the Maestro suite.

I1–I4, I7 and I9 are machine-checked by the gate. I5, I6 and I8 are verified
once by the scratch regeneration in `quickstart.md`; making them permanent CI
checks would mean running a full `expo prebuild` on every test run, which
Constitution principle V (Simplicity & YAGNI) does not justify for a property
two cheap string checks already defend against regression.

---

## State transitions

A permission moves between exactly these states, and each move has a required
set of edits. This is the checklist a future change adding or removing a
permission should follow.

```text
absent ──add──► declared
  edits: app.json (permission or plugin option, with a real purpose string)
       + ALLOWED_* set
       + a justification section
       + regenerate and commit the native tree

declared ──remove──► forbidden
  edits: app.json plugin option set to false (or permission deleted)
       + move the identifier out of ALLOWED_* and into FORBIDDEN_/BLOCKED_*
       + delete the justification section, add a "deliberately absent" row
       + delete from the committed native tree

declared ──remove, dependency still contributes it──► blocked   (Android only)
  edits: as above, plus app.json android.blockedPermissions, so the removal
         holds at manifest-merge time rather than only at prebuild time
```

Every transition touches `app.json` first. A change that begins in the
committed native tree is the defect this feature exists to fix.
