# Contract: verification scenarios

**Feature**: 053-ios-permission-declarations

Every acceptance scenario and success criterion in the spec, mapped to the
thing that actually verifies it. Nothing here is an RPC, so Constitution
principle II's integration-test surface does not apply; the analogue is the
store-manifest gate plus a small number of one-time manual verifications.

Each row names the verification, where it runs, and whether it is permanent
(re-run on every mobile test invocation) or one-time (performed once during
implementation and recorded in the PR).

---

## Permanent — enforced by the gate on every run

| ID | Scenario | Verification | Covers |
|---|---|---|---|
| V1 | Clean tree passes | `node frontend/apps/mobile/scripts/check-store-manifest.js` exits 0 with no `note:` lines | US3-1, FR-010, SC-005 |
| V2 | iOS declared set is exactly four | Gate checks 1.2, 1.3, 3.3 | US1-1, FR-005, SC-002 |
| V3 | Android declared set is exactly four | Gate checks 1.6, 1.7, 2.1 | US1-2, FR-005, SC-002 |
| V4 | No background-location key anywhere | Gate checks 1.1, 3.1 on `NSLocationAlways*` | US1-1, FR-001 |
| V5 | No biometric key or permission anywhere | Gate checks 1.1/3.1 on `NSFaceIDUsageDescription`; 1.8/2.2 on `USE_BIOMETRIC`, `USE_FINGERPRINT` | US1-1, US1-2, FR-002 |
| V6 | No local-network key in the committed tree | Gate checks 1.1, 3.1 on `NSLocalNetworkUsageDescription`, `NSBonjourServices` | US1-1, FR-003 |
| V7 | No purpose string is a library default | Gate check 3.4 — the new one. `Allow $(PRODUCT_NAME) …` fails the product-name rule | US1-5, FR-004, FR-013, SC-003 |
| V8 | Background location stays disabled in the plugin | Gate check 1.10 | FR-001 |
| V9 | Document and allow-lists agree | Gate checks 5.2, 5.3 | US4-3, FR-015 |
| V10 | Mobile suite reaches its flows | `make test-mobile` proceeds past `check-store-manifest` into `run-maestro-suite.sh` | US3-2, FR-014, SC-006 |

## Permanent — negative tests, run once per declaration to prove the gate bites

Each is performed by making the edit, running the gate, confirming it exits 1
with a message naming the identifier, then reverting. Ten in total: five
declarations × two locations, except where a location does not apply.

| ID | Edit | Expect |
|---|---|---|
| N1 | Add `NSLocationAlwaysUsageDescription` to `app.json` `ios.infoPlist` | fails, names the key |
| N2 | Add the same key to the committed `Info.plist` | fails, names the key |
| N3 | Add `NSLocationAlwaysAndWhenInUseUsageDescription` to `app.json` | fails, names the key |
| N4 | Add the same key to the committed `Info.plist` | fails, names the key |
| N5 | Set `faceIDPermission` to a real string, so `NSFaceIDUsageDescription` returns to `app.json` | fails, names the key |
| N6 | Add `NSFaceIDUsageDescription` to the committed `Info.plist` | fails, names the key |
| N7 | Add `NSLocalNetworkUsageDescription` + `NSBonjourServices` to the committed `Info.plist` | fails, names both keys |
| N8 | Add `android.permission.USE_BIOMETRIC` to `app.json` `android.permissions` | fails, names the permission as unexpected |
| N9 | Remove `USE_BIOMETRIC` from `blockedPermissions` | fails with `must block` |
| N10 | Replace `NSLocationWhenInUseUsageDescription` in the committed `Info.plist` with `Allow $(PRODUCT_NAME) to access your location` | fails on the product-name rule |

N10 is the regression test for this feature's own bug: it is the exact string
that shipped, in the exact file where it shipped.

Covers: US3-3, US3-4, FR-012, FR-013, SC-007.

## One-time — regeneration equivalence

Performed during implementation with the procedure in `quickstart.md`.

| ID | Scenario | Verification | Covers |
|---|---|---|---|
| G1 | Regeneration reproduces the removal | Prebuild into a scratch copy; the resulting `Info.plist` contains none of the five forbidden keys | US2-1, FR-006, I5 |
| G2 | Committed tree equals regeneration output | Diff the `*UsageDescription` key/value pairs of the scratch plist against the committed plist; empty in both directions | US2-2, FR-007, SC-004, I6 |
| G3 | Android merge strips the biometrics | The scratch `AndroidManifest.xml` carries `USE_BIOMETRIC` and `USE_FINGERPRINT` only in `tools:node="remove"` form, or not at all | US2-3, FR-008, I7 |
| G4 | Dev opt-in still works, both ways | Prebuild the scratch copy with `EXPO_LOCAL_DEV_NETWORK=1` — both keys present, string is the plugin's own; without it — both absent | US2-4, FR-009, I8 |

## One-time — human reading

| ID | Scenario | Verification | Covers |
|---|---|---|---|
| H1 | Every declared permission has exactly one justification | Read `docs/compliance/permission-justifications.md` against the four-plus-four target set: eight identifiers, eight entries, no Face ID section, no biometric Android section | US4-1, FR-015, SC-008 |
| H2 | The absences read as decisions | The "deliberately blocked" table gains `USE_BIOMETRIC` and `USE_FINGERPRINT`; the "keys deliberately absent" table gains `NSFaceIDUsageDescription`, each with a reason | US4-2, FR-016 |
| H3 | Domain docs match reality | `docs/domain/compliance-safety.md` describes the gate as passing and drops the workaround paragraph; D64 is removed from the drift register in `docs/domain/README.md` | FR-017, SC-009 |

## One-time — on a device

SC-001 and US1-3/US1-4 are about what a person is actually prompted for. They
are verified by hand on a simulator or device after a build from the production
configuration, because no automated harness in this repository observes system
permission dialogs — Maestro drives the app's own UI, not the OS consent
sheets.

| ID | Scenario | Verification | Covers |
|---|---|---|---|
| D1 | Four iOS prompts, no more | Fresh install; make a voice call, take a photo, attach from the library, check in at an event. Exactly four prompts, none for background location, biometrics or local network | US1-3, US1-4, SC-001 |
| D2 | The location prompt names the feature and says "while using" | Read the prompt text at check-in | US1-3 |

[ASSUMPTION: D1 and D2 are manual. Automating system-dialog observation would
mean adding a UI-automation harness that drives springboard alerts, which is a
substantially larger investment than the feature warrants and is not something
this repository does anywhere else. The gate's key-set assertions (V2–V6) give
the durable protection; the device pass confirms once that the declared set and
the prompted set coincide.]

---

## Coverage map

| Requirement | Verified by |
|---|---|
| FR-001 | V4, V8, N1–N4 |
| FR-002 | V5, N5, N6, N8 |
| FR-003 | V6, N7 |
| FR-004 | V7, H1 |
| FR-005 | V2, V3 |
| FR-006 | G1 |
| FR-007 | G2 |
| FR-008 | G3, N9 |
| FR-009 | G4 |
| FR-010 | V1 |
| FR-011 | V2, V3, V5 (the sets themselves), H1 |
| FR-012 | N1–N10 |
| FR-013 | V7, N10 |
| FR-014 | V10 |
| FR-015 | V9, H1 |
| FR-016 | H2 |
| FR-017 | H3 |
| SC-001 | D1 |
| SC-002 | V2, V3 |
| SC-003 | V7 |
| SC-004 | G2 |
| SC-005 | V1 |
| SC-006 | V10 |
| SC-007 | N1–N10 |
| SC-008 | H1 |
| SC-009 | H3 |
