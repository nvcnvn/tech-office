# Quickstart: validating feature 054

**Feature**: 054 | **Date**: 2026-09-12

Five checks. Two are commands, three are readings — which is the right ratio for a feature
whose deliverable is text a human reads in a store console. Run them in order; §3 is the
one that fails loudest if the work is incomplete.

**Prerequisites**: Node.js ≥ 20, `make`, a checkout of this branch. No database, no
running server, no simulator. `expo prebuild` output is optional — the gate says so itself
when it is missing, and the prose rule does not need it.

---

## 1. Every capability the review materials name exists (US1, FR-001…FR-004, SC-001, SC-002)

```bash
grep -rniE 'face id|touch id|biometric|fingerprint|background location|bluetooth|healthkit' docs/compliance/
```

**Expected**: every hit falls inside a declared recorded-absence section —
`Permissions deliberately blocked` or `Keys deliberately absent` in
`permission-justifications.md`, `Not collected` in `data-collection-inventory.md`,
`Not requested` in `reviewer-notes.md`, `Capabilities the app does not have` in
`age-rating-answers.md`. Zero hits in running prose. In particular, zero hits in the
`### Permissions` paragraph of the reviewer notes.

Then read the permissions paragraph itself:

```bash
sed -n '/^### Permissions/,/^## /p' docs/compliance/reviewer-notes.md
```

**Expected**: exactly five permissions named — microphone, camera, photos, location,
notifications — and no sixth (SC-002). Compare against `ALLOWED_IOS_KEYS` and
`ALLOWED_ANDROID_PERMISSIONS` in `frontend/apps/mobile/scripts/check-store-manifest.js`;
the two sets describe the same five things.

Then confirm FR-003 is a no-op, not a missed edit:

```bash
git diff main -- docs/compliance/permission-justifications.md
```

**Expected**: empty. The document was already correct at HEAD (research R-2). A non-empty
diff means something was removed that should have been kept.

## 2. The questionnaire can be answered from the repository (US2, FR-006…FR-015, SC-003…SC-006)

This one cannot be automated — SC-003 measures a person completing a form. The procedure:

1. Open `docs/compliance/age-rating-answers.md` beside both stores' age-rating
   questionnaires.
2. Work through the mandatory social-media capability group on each console, answering only
   from the document.
3. **Expected**: zero questions unanswered, zero escalations to an engineer (SC-003). A
   question the document does not cover is a defect in the document, not a gap to fill from
   memory — add the row.
4. Spot-check five rows' Evidence cells by following them (SC-004): open the named screen,
   reproduce the named behaviour, or read the named file. A cell that only restates the
   answer fails.
5. Confirm both `### Resulting rating` sections are filled in (SC-005), and that an
   unconfirmed one carries its provisional marker and date.

Then confirm there is one copy, not two:

```bash
grep -rn "Age rating\|age-rating\|age rating" docs/compliance/ | grep -v age-rating-answers.md
```

**Expected**: the only remaining hit is the one-line pointer in
`data-collection-inventory.md` (FR-015, SC-006). The four sentences of answers that used to
live there are gone.

## 3. The gate catches the regression (US3, FR-016…FR-018, SC-007, SC-008)

The self-check first — it is fast and needs nothing mutated:

```bash
node frontend/apps/mobile/scripts/check-compliance-prose.check.js
```

**Expected**: exits `0` silently, or prints its own pass line. It asserts scenarios G2, G5
and G6 from [contracts/prose-gate.md](contracts/prose-gate.md) against in-memory strings.

Then the live regression, once per document (SC-007). Do this with `git stash` or on a
scratch branch, never committed:

```bash
# Put the claim back into the reviewer notes
sed -i '' 's/camera and photos/camera and photos, Face ID (optional faster sign-in),/' \
  docs/compliance/reviewer-notes.md
make check-store-manifest ; echo "exit=$?"
git checkout docs/compliance/reviewer-notes.md
```

**Expected**: `exit=1`, and a failure line naming `docs/compliance/reviewer-notes.md`, the
line number, and `face id`. Repeat with a biometric sentence inserted into
`data-collection-inventory.md` outside its `Not collected` section, and into
`age-rating-answers.md` outside its recorded-absence section — three documents, three
failures (SC-007).

SC-008 is already covered by the clean run in §4: the biometric rows in
`permission-justifications.md` exist at HEAD and must not be reported.

## 4. The suite runs with the gate enabled (FR-019, SC-009)

```bash
make check-store-manifest
```

**Expected**: `store manifest check passed`, exit `0`. Possibly one `note:` line about a
missing `AndroidManifest.xml` or `Info.plist` if prebuild output is not present — that is
the pre-existing weaker-coverage note, not a failure.

```bash
make test-mobile
```

**Expected**: the gate passes and the Maestro suite proceeds. No step bypasses the gate;
`check-store-manifest` is a prerequisite of the target (`Makefile:289`), so a bypass would
show up as an edited Makefile in the diff.

## 5. The living documentation moved with the behaviour (FR-005, Constitution XII)

```bash
git diff main -- docs/domain/compliance-safety.md docs/domain/README.md
```

**Expected**:

- `compliance-safety.md` describes the corrected review materials and the gate's new prose
  rule, and no longer implies the gate's only document cross-check is the justifications
  file.
- `README.md`'s drift register has a new entry for the calendar check-in path requesting
  location permission and discarding the coordinate (research R-4), recorded as drift
  rather than fixed here.
- No entry describes behaviour this feature removed.
