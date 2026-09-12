---

description: "Task list for feature 053 — declare only the permissions the app actually uses"
---

# Tasks: Declare only the permissions the app actually uses

**Input**: Design documents from `/specs/053-ios-permission-declarations/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/store-manifest-gate.md](contracts/store-manifest-gate.md), [contracts/test-scenarios.md](contracts/test-scenarios.md), [quickstart.md](quickstart.md)

**Tests**: The spec does not request a new test harness, and this repository has
none for build-time configuration. The verification surface is the existing
store-manifest gate plus the one-time procedures in `quickstart.md`; those are
written as ordinary tasks below (T023–T025, T027–T030, T037–T038) rather than as
a separate test phase. No new test framework is introduced.

**Organization**: Tasks are grouped by user story so each can be implemented and
verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to the repository root `/Volumes/T5/Codes/tech-office`.
The four files that carry a permission declaration are:

- `frontend/apps/mobile/app.json` — the source configuration, edited first, always
- `frontend/apps/mobile/ios/TechOffice/Info.plist` — the committed iOS prebuild
- `frontend/apps/mobile/android/app/src/main/AndroidManifest.xml` — the committed Android prebuild
- `frontend/apps/mobile/scripts/check-store-manifest.js` — the gate's allow-lists

Plus `docs/compliance/permission-justifications.md` and the two `docs/domain/` files.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the starting state so every later claim about the gate is
measured against a recorded baseline rather than a remembered one.

- [X] T001 Run `node frontend/apps/mobile/scripts/check-store-manifest.js` and record the full stderr output verbatim in the PR description as the "before" baseline; confirm it exits 1 with exactly five problems (`app.json` missing `NSFaceIDUsageDescription`, plus `NSLocationAlwaysUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocalNetworkUsageDescription` and `NSBonjourServices` in the committed `frontend/apps/mobile/ios/TechOffice/Info.plist`). If the count is not five, stop and reconcile the drift register entry D64 in `docs/domain/README.md` before continuing.
- [X] T002 [P] Confirm the toolchain the later tasks assume: Node 22+ on `PATH`, and `frontend/apps/mobile/node_modules` present (run `pnpm install --filter mobile...` from `frontend/` if not). The gate runs under bare `node` with no install step; only the Phase 4 scratch prebuild needs the dependency tree.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Verify the single mechanism every removal in this feature depends
on. If `false` does not delete a key in the installed version of
`@expo/config-plugins`, the entire approach in US1 and US2 is wrong and must be
reconsidered before any file is edited.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Read `applyPermissions` (or its current equivalent) in `frontend/apps/mobile/node_modules/@expo/config-plugins/build/ios/Permissions.js` and confirm in the source that a permission option whose value is strictly `false` causes the key to be **deleted** from the `Info.plist` dictionary, while any other falsy value falls through to `options[key] || infoPlist[key] || default` — the fallback term that has preserved the hand-written `NSFaceIDUsageDescription` across every past regeneration (see R1 in [research.md](research.md)). Record the file path, the version from `node_modules/@expo/config-plugins/package.json`, and the deciding lines in the PR description.

**Checkpoint**: The `false`-deletes-the-key mechanism is confirmed against the installed source — the removals in Phase 3 are sound and Phase 4 can prove they survive regeneration.

---

## Phase 3: User Story 1 - The app asks only for what it uses (Priority: P1) 🎯 MVP

**Goal**: The built app declares exactly microphone, camera, photo library and
when-in-use location on iOS, and audio recording, coarse location, fine location
and notification posting on Android — with every removal expressed in
`app.json` first and the committed native trees brought into agreement second.

**Independent Test**: Enumerate the `*UsageDescription` keys in the committed
`Info.plist` and the un-removed `<uses-permission>` entries in the committed
`AndroidManifest.xml`. The first set has exactly four members, the second has
exactly four outside `ANDROID_PERMISSIONS_IGNORED`, and neither contains a
background-location, biometric or local-network entry. This is verifiable by
`grep` alone, without the gate having been touched yet.

### Implementation for User Story 1

The three `app.json` edits (T004–T006) touch one file and must be applied in
sequence. T007 and T008 touch different files and can proceed in parallel with
each other once the `app.json` edits are in, but never before them — the
ordering "source configuration first, generated tree second" is the distinction
this feature exists to draw (see the state-transition checklist in
[data-model.md](data-model.md)).

- [X] T004 [US1] In `frontend/apps/mobile/app.json`, add `"locationAlwaysPermission": false` and `"locationAlwaysAndWhenInUsePermission": false` to the `expo-location` plugin options object, alongside the existing `locationWhenInUsePermission` string and the two `isBackgroundLocationEnabled` flags. The value must be the JSON literal `false` — not `null`, not `""` — per T003.
- [X] T005 [US1] In `frontend/apps/mobile/app.json`, convert the bare `"expo-secure-store"` plugin entry into the array form `["expo-secure-store", { "faceIDPermission": false }]`, keeping its position in the `expo.plugins` array unchanged.
- [X] T006 [US1] In `frontend/apps/mobile/app.json`, append `"android.permission.USE_BIOMETRIC"` and `"android.permission.USE_FINGERPRINT"` to `expo.android.blockedPermissions` (which today holds `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`). Leave `expo.android.permissions` untouched — the biometric permissions arrive transitively and were never declared there.
- [X] T007 [P] [US1] In `frontend/apps/mobile/ios/TechOffice/Info.plist`, delete the five forbidden entries and their values: `NSBonjourServices` (an `<array>`, not a `<string>`), `NSLocalNetworkUsageDescription`, `NSFaceIDUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` and `NSLocationAlwaysUsageDescription`. Leave the four allowed `*UsageDescription` keys, `ITSAppUsesNonExemptEncryption`, and the entire `NSAppTransportSecurity` dictionary — including `NSAllowsLocalNetworking`, which is an ATS setting and not a declared permission (R7) — exactly as they are.
- [X] T008 [P] [US1] In `frontend/apps/mobile/android/app/src/main/AndroidManifest.xml`, change the `USE_BIOMETRIC` and `USE_FINGERPRINT` `<uses-permission>` lines to carry `tools:node="remove"`, matching the form already used by `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` on the surrounding lines. Keep the entries in the file's existing alphabetical order.
- [X] T009 [US1] Enumerate the result and confirm the target sets: `grep -c 'UsageDescription' frontend/apps/mobile/ios/TechOffice/Info.plist` reports four, and `grep 'uses-permission' frontend/apps/mobile/android/app/src/main/AndroidManifest.xml` shows exactly `RECORD_AUDIO`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` and `POST_NOTIFICATIONS` without `tools:node="remove"`, plus `INTERNET` and `VIBRATE` (both in `ANDROID_PERMISSIONS_IGNORED`), plus five `tools:node="remove"` entries.
- [X] T010 [US1] Confirm nothing under `frontend/apps/mobile/src/` changed: `git status --short frontend/apps/mobile/src` is empty. The location, camera, photo and microphone flows are unchanged by this feature, and a diff there means a removal was made in the wrong place.

**Checkpoint**: The declared permission set matches FR-005 on both platforms. The gate still fails at this point — its allow-lists have not been narrowed yet — which is expected and is fixed in Phase 5.

---

## Phase 4: User Story 2 - Removing a permission survives the next rebuild (Priority: P1)

**Goal**: Prove the removals are source-level, not hand-scrubbed — regenerating
the native projects from `app.json` alone reproduces them, and the committed
tree is what regeneration produces rather than a variant of it.

**Independent Test**: Prebuild a scratch copy of the mobile app from `app.json`
with `ios/` and `android/` deleted, then diff the permission-bearing entries of
the result against the committed trees. They agree in both directions.

**Why not automated**: making this a permanent CI check means running a full
`expo prebuild` on every mobile test run, which principle V does not justify for
a property that two cheap string checks already defend against regression
(R4, and the I5/I6/I8 note in [data-model.md](data-model.md)). It is performed
once here and recorded.

### Implementation for User Story 2

- [X] T011 [US2] Create the scratch copy per part 3 of [quickstart.md](quickstart.md): `rm -rf /tmp/053-prebuild-check && cp -R frontend/apps/mobile /tmp/053-prebuild-check`, then inside it `rm -rf ios android && npx expo prebuild --no-install`. Do **not** regenerate the committed trees in place — `frontend/apps/mobile/plugins/with-ios-dev-client-bootstrap.js` patches the Xcode project with a Metro-host build phase that an in-place `--clean` would put at risk (R4).
- [X] T012 [US2] Enumerate the scratch iOS result: `plutil -p /tmp/053-prebuild-check/ios/TechOffice/Info.plist | grep -E 'UsageDescription|BonjourServices'`. Confirm exactly four lines — microphone, camera, photo library, when-in-use location — and that none of the five forbidden keys appears. Records G1 / FR-006 / I5.
- [X] T013 [US2] Diff the four scratch key/value pairs against the committed `frontend/apps/mobile/ios/TechOffice/Info.plist`, in both directions. If they differ, fix the **committed** file to match the regeneration output, never the reverse. Records G2 / FR-007 / SC-004 / I6.
- [X] T014 [US2] Enumerate the scratch Android manifest: `grep -n 'uses-permission' /tmp/053-prebuild-check/android/app/src/main/AndroidManifest.xml`. Confirm `USE_BIOMETRIC` and `USE_FINGERPRINT` are either absent entirely or present only with `tools:node="remove"`, and that the four allowed permissions match the committed manifest. Reconcile the committed manifest to the scratch output if they differ. Records G3 / FR-008 / I7.
- [X] T015 [US2] Verify the development opt-in still works in both directions per part 4 of [quickstart.md](quickstart.md): in the scratch copy, `rm -rf ios && EXPO_LOCAL_DEV_NETWORK=1 npx expo prebuild --platform ios --no-install` must yield `NSLocalNetworkUsageDescription` = `Tech Office connects to a local development server while debugging.` and `NSBonjourServices` = `["_http._tcp"]`; then `rm -rf ios && npx expo prebuild --platform ios --no-install` must yield neither. `frontend/apps/mobile/plugins/with-dev-local-network.js` is not modified by this feature. Records G4 / FR-009 / I8.
- [X] T016 [US2] Record the outcome of T012–T015 in the PR description — the four scratch key/value pairs, the Android result, and both halves of the opt-in check — so the one-time verification is reviewable without re-running it. Then `rm -rf /tmp/053-prebuild-check` and confirm `git status --short frontend/apps/mobile/ios` shows only the intended `Info.plist` change, with no stray dev-opt-in keys committed.

**Checkpoint**: The removals are proven to survive a from-scratch regeneration, and the committed trees equal what regeneration produces.

---

## Phase 5: User Story 3 - The automated gate catches the next one (Priority: P2)

**Goal**: The gate passes on the clean tree, its allow-lists describe the app
rather than accommodating the discrepancy, it reads purpose strings out of the
committed `Info.plist` where the placeholder actually lives, and
`make test-mobile` reaches the Maestro suite through its normal entry point.

**Independent Test**: `node frontend/apps/mobile/scripts/check-store-manifest.js`
exits 0 with no `note:` lines. Then reintroduce any one of the five removed
declarations and confirm the gate exits 1 with a message naming it.

### Implementation for User Story 3

T017–T020 all edit `frontend/apps/mobile/scripts/check-store-manifest.js` and
are therefore sequential. T017 and T018 must land together: dropping
`NSFaceIDUsageDescription` from `ALLOWED_IOS_KEYS` without adding it to
`FORBIDDEN_IOS_KEYS` would leave the committed plist unchecked for it
(see the asymmetry note in [data-model.md](data-model.md)).

- [X] T017 [US3] In `frontend/apps/mobile/scripts/check-store-manifest.js`, remove `"NSFaceIDUsageDescription"` from `ALLOWED_IOS_KEYS`, leaving the four entries of FR-005.
- [X] T018 [US3] In the same file, add `"NSFaceIDUsageDescription"` to `FORBIDDEN_IOS_KEYS` with a comment recording why (no biometric sign-in exists in the app; FR-002), placing it after the two `NSLocationAlways*` entries and before the two development-only entries. Update the two existing comment blocks that cite `FR-027`/`FR-029` to cite this feature's `FR-001`/`FR-003` instead, so the constants point at the requirements that currently govern them.
- [X] T019 [US3] In the same file, remove `"android.permission.USE_BIOMETRIC"` and `"android.permission.USE_FINGERPRINT"` from `ALLOWED_ANDROID_PERMISSIONS` and add both to `BLOCKED_ANDROID_PERMISSIONS`, bringing the blocked list to five entries. `REQUIRED_ANDROID_PERMISSIONS` and `ANDROID_PERMISSIONS_IGNORED` are unchanged — in particular `FOREGROUND_SERVICE` stays ignored.
- [X] T020 [US3] In the same file's committed-`Info.plist` section (the `if (fs.existsSync(infoPlistPath))` block), add checks 3.3 and 3.4 from [contracts/store-manifest-gate.md](contracts/store-manifest-gate.md): extract every `<key>NAME</key>` immediately followed by `<string>VALUE</string>` with a regular expression, and for each key ending in `UsageDescription` fail with `Info.plist declares an unexpected iOS permission ${key}.` when it is not in `ALLOWED_IOS_KEYS`, and call `checkPermissionString("Info.plist " + key, value)` on its value. Parse as text — no plist dependency; the generated top-level dictionary is flat, and a dependency-free gate is what keeps it cheap enough to sit in front of every mobile test run. Keys whose value is not a `<string>` (for example `NSBonjourServices`, an `<array>`) are matched by the existing forbidden-key check on the key alone and are correctly skipped here.
- [X] T021 [US3] Confirm `checkPermissionString` is left unchanged and that its `/tech office/i` product-name rule is what rejects `Allow $(PRODUCT_NAME) to access your location` — a framework default uses the Xcode build-setting placeholder, never the literal product name. No new string heuristic is added (R5, FR-013).
- [X] T022 [US3] Confirm the gate's plugin-option pass (check 1.9) skips a non-string option rather than failing it, so `faceIDPermission: false` and the two `locationAlways*: false` values from Phase 3 do not trip the 40-character minimum. This is existing behaviour and requires no edit, but it is load-bearing for this feature and must be checked, not assumed.
- [X] T023 [US3] Run `node frontend/apps/mobile/scripts/check-store-manifest.js` and confirm it prints `store manifest check passed`, exits 0, and emits **no** `note:` lines — both committed native manifests exist, so coverage is full rather than partial. Records V1 / FR-010 / SC-005. Note that this cannot pass until Phase 6 has run, because checks 5.2/5.3 require the justification document to mention every allow-list entry; if the only remaining failures name the document, proceed to Phase 6 and return here.
- [X] T024 [US3] Run `make test-mobile` and confirm it proceeds past `check-store-manifest` into `check-backend`, `check-maestro`, `check-maestro-env` and on into `run-maestro-suite.sh`. What is being verified is the transition past the gate; a later failure inside a Maestro flow is a separate problem and not this feature's concern. Records V10 / FR-014 / SC-006.
- [X] T025 [US3] Perform the ten negative edits N1–N10 from [contracts/test-scenarios.md](contracts/test-scenarios.md), one at a time — make the edit, run the gate, confirm exit 1 with the identifier named in stderr, then `git checkout --` the file. N10 is the regression test for this feature's own bug: replace the committed `NSLocationWhenInUseUsageDescription` value with `Allow $(PRODUCT_NAME) to access your location` — the exact string that shipped, in the exact file where it shipped — and confirm the new check 3.4 rejects it on the product-name rule. Record the ten identifiers and exit codes in the PR description. Records N1–N10 / FR-012 / FR-013 / SC-007.

**Checkpoint**: The gate passes on a clean tree, bites on all ten reintroductions, and `make test-mobile` is once again the suite's entry point. D64's mechanism is fixed.

---

## Phase 6: User Story 4 - The permission document and the app agree (Priority: P3)

**Goal**: The written justifications describe exactly the eight permissions the
app declares, the removed ones are recorded as decisions rather than
disappearing silently, and the domain documentation stops describing a gate that
fails.

**Independent Test**: Read `docs/compliance/permission-justifications.md`
against the four-plus-four target set: eight identifiers, eight entries, no Face
ID section, no Android biometric section, and the two absence tables naming
every removed identifier with a reason.

**Ordering note**: the gate asserts presence, never absence (checks 5.2/5.3), so
it stays satisfied while the sections are deleted — `USE_BIOMETRIC` and
`USE_FINGERPRINT` keep appearing in the "deliberately blocked" table, and they
are no longer in `ALLOWED_ANDROID_PERMISSIONS` after T019 anyway. The document
and the allow-lists must nevertheless land in the same change set (FR-015,
and the document's own standing obligation).

### Implementation for User Story 4

- [X] T026 [US4] In `docs/compliance/permission-justifications.md`, delete the `### \`NSFaceIDUsageDescription\`` section under `## iOS` and the `### \`android.permission.USE_BIOMETRIC\` and \`android.permission.USE_FINGERPRINT\`` section under `## Android`. The remaining sections must be exactly one per declared permission: four iOS keys, and four Android permissions across three sections (the two location grades share one).
- [X] T027 [US4] In the same file, add `| \`android.permission.USE_BIOMETRIC\`, \`android.permission.USE_FINGERPRINT\` | ... |` to the `## Permissions deliberately blocked` table, with the reason: no biometric sign-in exists anywhere in the app — the only secure-storage call configures at-rest key protection and never requests authentication, and no biometric authentication library is a dependency. They arrive transitively and are stripped at manifest-merge time. Records H2 / FR-016.
- [X] T028 [US4] In the same file, add `NSFaceIDUsageDescription` to the `## Keys deliberately absent` table with the same reason, so the next person to wonder why finds the answer instead of re-adding the key. Records H2 / FR-016.
- [X] T029 [P] [US4] In `docs/domain/compliance-safety.md`, rewrite the paragraph at line ~256 that states the gate "does **not** pass at HEAD (D64)": describe it as passing, drop the claim that the dev-client and LiveKit need the local-network keys in the committed prebuild (they need them only behind `EXPO_LOCAL_DEV_NETWORK=1`), drop the `run-maestro-suite.sh` workaround sentence, and record the gate's new coverage — that it now reads purpose strings out of the committed `Info.plist`, not only out of `app.json`. Records H3 / FR-017.
- [X] T030 [P] [US4] In `docs/domain/README.md`, delete the D64 row from the drift register (line ~92). Confirm no replacement drift is opened — SC-009 requires the entry to close, not to be restated in a new form.
- [X] T031 [US4] Cross-read the document against the gate: every entry of `ALLOWED_IOS_KEYS` and `ALLOWED_ANDROID_PERMISSIONS` appears in `docs/compliance/permission-justifications.md` as a literal substring, and no section justifies a permission the app does not declare. Records H1 / V9 / FR-015 / SC-008.

**Checkpoint**: The document, the allow-lists, the source configuration and the committed native trees all describe the same eight permissions. Return to T023 if it was deferred.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T032 Re-run `node frontend/apps/mobile/scripts/check-store-manifest.js` on the fully-assembled tree and confirm exit 0 with no `note:` lines and no failures — this is the "after" figure against the five-problem baseline recorded in T001.
- [X] T033 Review the complete diff against the plan's file list: `frontend/apps/mobile/app.json`, `ios/TechOffice/Info.plist`, `android/app/src/main/AndroidManifest.xml`, `scripts/check-store-manifest.js`, `docs/compliance/permission-justifications.md`, `docs/domain/compliance-safety.md`, `docs/domain/README.md` — and nothing else. In particular `Makefile`, `frontend/apps/mobile/plugins/with-dev-local-network.js` and every file under `frontend/apps/mobile/src/` must be untouched.
- [X] T034 Work through the Definition of Done checklist at the foot of [quickstart.md](quickstart.md) and tick each item, leaving the device pass (T035) for last.
- [ ] T035 **NOT DONE — needs a device and a human.** Build from the production configuration and install on a fresh iOS simulator or device; exercise every capability flow — start a voice call, take a photo, attach a photo from the library, and check in at a calendar event or complete a task requiring location evidence. Confirm exactly four system prompts, none for background location, Face ID or local-network access, and that the location prompt offers "While Using the App" and reads the check-in sentence from `app.json`. Records D1 / D2 / SC-001 / US1-3 / US1-4.
- [ ] T036 [P] **NOT DONE — needs a device and a human.** Repeat the capability sweep on a fresh Android install and confirm three prompts — audio recording, location (the two grades being a single prompt) and notifications — with no biometric prompt. Records SC-001 for Android.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks everything** — T003 validates the one mechanism every removal relies on.
- **User Story 1 (Phase 3)**: depends on Phase 2. Nothing depends on it being finished before US3's gate edits begin, but the gate cannot *pass* until it is.
- **User Story 2 (Phase 4)**: depends on Phase 3 — there is nothing to prove survives regeneration until the removals exist.
- **User Story 3 (Phase 5)**: the gate edits (T017–T022) depend only on Phase 2 and can run in parallel with Phase 3/4. The verification tasks (T023–T025) depend on Phase 3 and Phase 6.
- **User Story 4 (Phase 6)**: depends only on T019 (so the allow-list and the document narrow together). Otherwise independent.
- **Polish (Phase 7)**: depends on all of the above.

### User Story Dependencies

- **US1 (P1)**: independent. Delivers the compliant declaration set on its own.
- **US2 (P1)**: depends on US1's edits existing; verifies rather than changes them. The one reconciliation path (T013, T014) writes back into US1's files.
- **US3 (P2)**: the allow-list narrowing is independent of US1, but the gate's green result requires US1 and US4.
- **US4 (P3)**: independent of US1 and US2; coupled to US3 only through T019.

### Within Each User Story

- `app.json` before the committed native tree, always. A change that begins in the generated tree is the defect this feature exists to fix.
- Allow-list and justification document narrow in the same change set.
- Removal before verification; verification before documentation of the result.

### Parallel Opportunities

- T007 and T008 (different native trees) after the `app.json` edits land.
- T029 and T030 (different documentation files).
- T036 alongside T035 if two devices are available.
- Phase 5's T017–T022 can proceed alongside Phase 3 and Phase 4 if two people are working — they touch only `check-store-manifest.js`.
- T004–T006 are **not** parallel (one file), and neither are T017–T020 (one file).

---

## Parallel Example: User Story 1

```bash
# After T004-T006 have landed in app.json, the two committed native trees
# are independent files and can be edited together:
Task: "Delete the five forbidden keys from frontend/apps/mobile/ios/TechOffice/Info.plist"
Task: "Mark USE_BIOMETRIC and USE_FINGERPRINT tools:node=\"remove\" in frontend/apps/mobile/android/app/src/main/AndroidManifest.xml"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — record the five-problem baseline.
2. Phase 2: Foundational — confirm `false` deletes the key (blocks everything).
3. Phase 3: User Story 1 — the removals, source first.
4. **STOP and VALIDATE**: enumerate both committed manifests; four keys and four permissions, nothing forbidden.

At this point the app is compliant. The gate still fails, because its
allow-lists still describe the old set — which is why US3 is not optional in
practice even though US1 is the MVP.

### Incremental Delivery

1. Setup + Foundational → the mechanism is proven.
2. US1 → the app declares only what it uses. **Compliance achieved.**
3. US2 → the removal is proven to survive regeneration. **Fix rather than patch.**
4. US3 → the gate passes and bites. **`make test-mobile` returns; D64 closes.**
5. US4 → the documentation agrees. **Submission-ready.**

### Parallel Team Strategy

With two people, after Phase 2:

- Developer A: Phase 3 (US1) then Phase 4 (US2) — the configuration and native trees.
- Developer B: T017–T022 (US3 gate edits) then Phase 6 (US4 docs) — the gate and the prose.
- Both converge on T023–T025, then Phase 7.

---

## Notes

- [P] tasks = different files, no dependencies.
- The single most load-bearing detail in this feature is that the plugin option value must be the literal `false` — not `undefined`, not `""`. Any other value falls through to `options[key] || infoPlist[key] || default`, and that middle term is exactly why the hand-written Face ID string has survived every regeneration so far.
- An engineer who runs `EXPO_LOCAL_DEV_NETWORK=1 expo prebuild` in the repository itself produces local modifications to `ios/TechOffice/Info.plist` that must not be committed. The gate is the backstop; the habit to keep is `git checkout -- frontend/apps/mobile/ios/` before committing.
- No new dependency, no new script, no new Makefile target. If a task seems to call for one, re-read the plan before adding it.
- Commit after each phase, not each task — the phases are the reviewable units here, and a half-narrowed allow-list is a broken intermediate state.
