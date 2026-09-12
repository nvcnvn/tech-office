# Quickstart: verifying feature 053

**Feature**: 053-ios-permission-declarations

How to prove this feature works, end to end. Five parts, in order. Parts 1 and
2 take seconds and run on every future change; parts 3 to 5 are performed once,
during implementation.

## Prerequisites

- Node 22+ and `pnpm`, with `frontend/apps/mobile/node_modules` installed
- For part 3 only: enough disk for a scratch copy of the mobile app, and
  network access for `expo prebuild` to resolve its config plugins
- For part 5 only: an iOS simulator or device, and a build from the production
  configuration

No backend, no database, no running services. This feature touches build-time
configuration only.

---

## 1. The gate passes

```bash
cd frontend/apps/mobile
node scripts/check-store-manifest.js
```

**Before this feature**: exits 1 with five problems — `app.json` missing
`NSFaceIDUsageDescription`, and four forbidden keys in the committed
`Info.plist`.

**After**: exits 0 and prints `store manifest check passed`, with no `note:`
lines — both native manifests are committed, so coverage is full rather than
partial.

Covers V1, and by construction V2–V9 (see
[contracts/test-scenarios.md](contracts/test-scenarios.md)).

## 2. The mobile suite reaches its flows

```bash
make test-mobile
```

**Before**: aborts on `check-store-manifest` before a single Maestro flow runs,
which is why the suite has had to be reached through
`frontend/apps/mobile/scripts/run-maestro-suite.sh` directly. **After**: the
gate passes and `make` proceeds through `check-backend`, `check-maestro`,
`check-maestro-env` into the suite.

The point of this step is the transition past the gate. If the run later fails
inside a Maestro flow, that is a separate problem and not this feature's
concern — what is being verified is that `make test-mobile` is once again the
entry point.

Covers V10, FR-014, SC-006.

## 3. Removals survive regeneration

The committed native trees are **not** regenerated in place — see R4 in
[research.md](research.md). Regenerate into a scratch copy and compare only the
permission-bearing entries.

```bash
cd /tmp && rm -rf 053-prebuild-check
cp -R /path/to/tech-office/frontend/apps/mobile 053-prebuild-check
cd 053-prebuild-check
rm -rf ios android                      # regenerate these from app.json alone
npx expo prebuild --no-install
```

Then compare:

```bash
# iOS: the permission keys the source configuration actually produces
plutil -p ios/TechOffice/Info.plist | grep -E 'UsageDescription|BonjourServices'
```

**Expect** exactly four lines — microphone, camera, photo library, when-in-use
location — with the strings from `app.json`, and no `NSLocationAlways*`, no
`NSFaceIDUsageDescription`, no `NSLocalNetworkUsageDescription`, no
`NSBonjourServices`. Diff those four key/value pairs against the committed
`frontend/apps/mobile/ios/TechOffice/Info.plist`: identical in both directions.

```bash
# Android: the biometric permissions must be absent or explicitly removed
grep -n 'uses-permission' android/app/src/main/AndroidManifest.xml
```

**Expect** `USE_BIOMETRIC` and `USE_FINGERPRINT` either absent entirely or
present only with `tools:node="remove"`, and the same four allowed permissions
as the committed manifest.

Covers G1, G2, G3 — FR-006, FR-007, FR-008, SC-004.

> **Do not `cp -R` to `/tmp`.** The copy is ~4 GB (committed `.ipa` files, a
> 30 MB build log, `ios/Pods`, `ios/build`) and its pnpm `node_modules` entries
> are relative symlinks into `frontend/node_modules/.pnpm/`, which break outside
> the workspace — prebuild then resolves no plugin at all. Make the scratch
> project at the same directory depth instead, e.g.
> `frontend/apps/053-prebuild-check`, holding only `app.json`, `package.json`,
> the two Google service files, and symlinks to `node_modules`, `assets`,
> `plugins`, `app` and `src`. It takes seconds. Delete it when done — it is
> inside the repository.

## 4. The development opt-in still works

Same scratch copy. This is the edge case the feature must not break: an
engineer debugging against a Metro server on a physical device needs the
local-network keys.

```bash
cd /tmp/053-prebuild-check
rm -rf ios
EXPO_LOCAL_DEV_NETWORK=1 npx expo prebuild --platform ios --no-install
plutil -p ios/TechOffice/Info.plist | grep -E 'LocalNetwork|BonjourServices'
```

**Expect** `NSLocalNetworkUsageDescription` set to
`Tech Office connects to a local development server while debugging.` and
`NSBonjourServices` set to `["_http._tcp"]` — the plugin's own strings, not the
`Expo Dev Launcher …` text that shipped.

Then without the switch:

```bash
rm -rf ios && npx expo prebuild --platform ios --no-install
plutil -p ios/TechOffice/Info.plist | grep -E 'LocalNetwork|BonjourServices'
```

**Expect** no matches.

Covers G4, FR-009, US2-4.

> **The friction, stated plainly**: because the generated `ios/` tree is
> committed and EAS builds it as-is, an engineer who runs
> `EXPO_LOCAL_DEV_NETWORK=1 expo prebuild` in the repository itself produces
> local changes to `ios/TechOffice/Info.plist` that **must not be committed**.
> The gate is the backstop — it fails on those keys in the committed plist —
> but the habit to keep is `git checkout -- ios/` before committing.

## 5. The gate bites when a permission comes back

Ten edits, each made, checked, and reverted. The full list is N1–N10 in
[contracts/test-scenarios.md](contracts/test-scenarios.md). The shape of each:

```bash
cd frontend/apps/mobile
# make the edit, e.g. add "NSFaceIDUsageDescription" back to the committed Info.plist
node scripts/check-store-manifest.js ; echo "exit=$?"
git checkout -- ios/TechOffice/Info.plist app.json
```

**Expect** `exit=1` every time, with a message naming the identifier that was
reintroduced. `grep`-ing the stderr for the identifier is the assertion.

N10 deserves its own run: replace the committed
`NSLocationWhenInUseUsageDescription` value with
`Allow $(PRODUCT_NAME) to access your location` — the exact placeholder that
shipped — and confirm the gate now rejects it on the product-name rule. Before
this feature it did not, because the gate never read the strings in the
committed plist.

Covers N1–N10, FR-012, FR-013, SC-007.

## 6. On a device

Install a build from the production configuration on a fresh simulator or
device and exercise every capability flow: start a voice call, take a photo,
attach a photo from the library, and check in at a calendar event or complete a
task that requires location evidence.

**Expect** exactly four system prompts on iOS, and never a prompt for
background location, Face ID, or local-network access. The location prompt must
offer "While Using the App" and read
*Tech Office uses your location to confirm you are at the job site when you
check in or complete a task. It is only used while the app is open.*

Covers D1, D2, SC-001, US1-3, US1-4.

---

## Definition of done

- [x] Gate exits 0 with no partial-coverage notes (part 1)
- [x] `make test-mobile` reaches the Maestro suite (part 2)
- [x] Scratch regeneration agrees with the committed trees (part 3)
- [x] `EXPO_LOCAL_DEV_NETWORK=1` still injects the dev keys, and nothing without it (part 4)
- [x] All ten negative edits fail the gate by name (part 5)
- [ ] Four prompts on device, and no others (part 6) — **not done**: needs a production-configuration build on a fresh device and a human counting consent sheets; see `verification-record.md`
- [x] `docs/compliance/permission-justifications.md` has eight entries and no biometric justification
- [x] `docs/domain/compliance-safety.md` describes the gate as passing; D64 removed from the drift register in `docs/domain/README.md`
