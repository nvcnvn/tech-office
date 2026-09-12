---

description: "Task list for feature 054 — compliance prose and age-rating answers"
---

# Tasks: Compliance prose describes the app that exists, and the age rating answers the questions now asked

**Input**: Design documents from `/specs/054-compliance-prose-age-rating/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/prose-gate.md](contracts/prose-gate.md),
[contracts/age-rating-answers.md](contracts/age-rating-answers.md),
[quickstart.md](quickstart.md)

**Tests**: no backend integration or Playwright scenarios — the plan's justified exclusion
from Constitution principle II stands (there is no RPC and no UI in this feature). The one
executable artifact requested by the plan is the region-parser self-check
(`frontend/apps/mobile/scripts/check-compliance-prose.check.js`), which is an
implementation task inside User Story 3 rather than a test-first task.

**Organization**: grouped by user story. US1 ships alone as the MVP; US2 and US3 are
independent of each other and both build on the document shapes US1 establishes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3, mapping to the user stories in [spec.md](spec.md)
- Every task names the exact file it touches

## Path Conventions

Repository root is `/Volumes/T5/Codes/tech-office`. This feature touches three areas only:

- `docs/compliance/` — the review materials pasted into the store consoles
- `docs/domain/` — the living behaviour snapshots (Constitution XII)
- `frontend/apps/mobile/scripts/` — the store-manifest gate and its self-check

No backend, no proto, no migration, no UI.

## Assumptions recorded during task generation

- [ASSUMPTION: T013–T014 require reading the live age-rating questionnaires in App Store
  Connect and Play Console, which needs console credentials this repository does not
  carry. If the consoles are not reachable when the tasks are executed, transcribe the
  question wording from the most recent known form, mark the document's "last checked
  against the live forms" date as the date of that known form rather than today, and add
  a one-line note in the document saying the wording is unverified against the live
  console. Research R-7 and FR-014 already anticipate a stale transcription being visible
  rather than silent; this makes the unverified state visible in the same way. Faking a
  current date would defeat the only mechanism the document has for showing its own age.]
- [ASSUMPTION: T033 (`make test-mobile`) needs a Maestro install, a device or emulator and
  the mobile env file. When that environment is unavailable, run `make check-store-manifest`
  alone — it is the gate FR-019 and SC-009 name, and it is the first prerequisite of the
  target — and record that the Maestro half of the target was not exercised. The feature
  changes no mobile UI, so a Maestro run has nothing of this feature's to fail on; the
  gate does.]
- [ASSUMPTION: the drift register entry in T021 is numbered as the next unused `D<n>` in
  `docs/domain/README.md` at implementation time rather than fixed here, because the
  register gains entries from other branches and a number chosen now would collide.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: establish the baseline this feature is measured against, so a later failure is
attributable to this work rather than to something already broken.

- [ ] T001 Run `make check-store-manifest` at the current HEAD and record that it passes, establishing the pre-change baseline for FR-019 (output goes in the implementation notes, not into a tracked file)
- [ ] T002 [P] Read the declared permission set out of `frontend/apps/mobile/scripts/check-store-manifest.js` (`ALLOWED_IOS_KEYS`, `ALLOWED_ANDROID_PERMISSIONS`) and confirm it collapses to exactly five reviewer-facing permissions — microphone, camera, photos, location, notifications — which is the set SC-002 compares the reviewer notes against

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the single fact every story depends on — what "declared" means. There is no
schema, framework, or shared module to build; this phase is one task and exists so that the
three stories do not each re-derive the declared set differently.

**⚠️ CRITICAL**: T003 must be settled before any document or gate edit, because all three
stories compare prose against this set.

- [ ] T003 Confirm from `frontend/apps/mobile/scripts/check-store-manifest.js` that no biometric declaration exists in the allowed set — `NSFaceIDUsageDescription` is in `FORBIDDEN_IOS_KEYS`, `android.permission.USE_BIOMETRIC` and `USE_FINGERPRINT` are in `BLOCKED_ANDROID_PERMISSIONS`, and `expo-secure-store`'s `faceIDPermission` is pinned `false` in `frontend/apps/mobile/app.json` (research R-1); this is the fact that makes every biometric sentence in `docs/compliance/` a false claim

**Checkpoint**: the declared set is fixed. All three stories can now proceed.

---

## Phase 3: User Story 1 - Every capability the review materials name can be found in the app (Priority: P1) 🎯 MVP

**Goal**: a reviewer following the pasted notes finds every permission the notes claim, and
no compliance document describes the behaviour of a capability that does not exist.

**Independent Test**: take the permissions paragraph of `docs/compliance/reviewer-notes.md`
and the `### Not collected` list of `docs/compliance/data-collection-inventory.md` and check
every capability word against the declared set from T003 and against the code. Ships a clean
review packet with neither US2 nor US3 built.

### Implementation for User Story 1

- [ ] T004 [US1] Remove the clause "Face ID (optional faster sign-in)" from the `### Permissions` paragraph of `docs/compliance/reviewer-notes.md` (line ~127), leaving exactly five permissions named — microphone, camera and photos, location, notifications — and removing rather than rewording the clause (FR-001, SC-002)
- [ ] T005 [US1] Add a `### Not requested` section to `docs/compliance/reviewer-notes.md` immediately after `### Permissions`, and move the sentence "There is no background location." out of the permissions paragraph into it, phrased as what the app does not ask for and why (research R-5; this is the recorded-absence section the gate will declare for this file in T022). Depends on T004 — same paragraph
- [ ] T006 [P] [US1] In `docs/compliance/data-collection-inventory.md` under `### Not collected` (line ~66 region), replace the sentence "Face ID and fingerprint sign-in are performed by the operating system; the app receives only success or failure and never the biometric itself" with a statement that the app performs no biometric authentication at all, describing no data flow for one (FR-002)
- [ ] T007 [P] [US1] Verify `docs/compliance/permission-justifications.md` at HEAD contains no justification section for a permission the app does not request, and that both recorded-absence rows survive untouched — the `USE_BIOMETRIC`/`USE_FINGERPRINT` row in *Permissions deliberately blocked* and the `NSFaceIDUsageDescription` row in *Keys deliberately absent* (FR-003, research R-2). This task produces no edit; a non-empty `git diff main --` on this file at the end of the feature is a defect
- [ ] T008 [US1] Sweep every `*.md` under `docs/compliance/` for the capability vocabulary in research R-6 and confirm each remaining occurrence is either a capability in the declared set or sits inside a recorded-absence section, fixing any occurrence that is neither (FR-004, SC-001). Depends on T004–T007
- [ ] T009 [US1] Update the review-materials description in `docs/domain/compliance-safety.md` so its `## Permissions` and review-notes material match the corrected documents and no longer imply a biometric sign-in exists anywhere (FR-005, Constitution XII)

**Checkpoint**: the review packet names only findable capabilities. US1 is shippable on its
own.

---

## Phase 4: User Story 2 - The age-rating questionnaire can be answered from the repository (Priority: P2)

**Goal**: one document answers both stores' age-rating questionnaires, every answer carrying
evidence a reviewer or engineer can check, with the closed-workspace boundary stated before
the answers so the honest `Yes` answers cannot be misread as a social network.

**Independent Test**: hand `docs/compliance/age-rating-answers.md` to someone who has never
seen the codebase, with both questionnaires open, and watch them complete the social-media
capability section with no follow-up question to an engineer (SC-003).

### Implementation for User Story 2

- [ ] T010 [US2] Create `docs/compliance/age-rating-answers.md` with the skeleton required by [contracts/age-rating-answers.md](contracts/age-rating-answers.md): title, purpose sentence naming it as the single source both questionnaires are filled from, the "last checked against the live forms: YYYY-MM-DD" line, and the standing-obligation block in the same shape as `data-collection-inventory.md`'s existing Definition of Done (FR-006, FR-014)
- [ ] T011 [US2] Write the `## The workspace boundary` section of `docs/compliance/age-rating-answers.md`: membership arises only from an invitation or an administrator, no surface reaches a person in another workspace, citing `AcceptInvitation`, admin member management, and the `organization_id` tenancy rule enforced by `make lint-tenancy` (FR-009)
- [ ] T012 [US2] Write the `## Safeguards` section of `docs/compliance/age-rating-answers.md` listing all five after-the-fact safeguards with their citations: in-app reporting from a message's menu; the owner-side report queue with its content snapshot, web-only behind `compliance.reviewReports`; blocking scoped to direct contact with the reason for that scope; published terms with per-account acceptance (`iam.CurrentTermsVersion`); and `ABUSE_CONTACT_EMAIL` in `frontend/packages/apis/src/legal.ts` (FR-010)
- [ ] T013 [US2] Transcribe the App Store Connect mandatory capability question wording into an `## App Store Connect` section of `docs/compliance/age-rating-answers.md` and fill one **Question | Answer | Evidence | Qualifier** row per question, covering at minimum the ten areas in [contracts/age-rating-answers.md](contracts/age-rating-answers.md) using the verified answers in research R-7 (FR-007, FR-008, FR-013). Depends on T010
- [ ] T014 [US2] Transcribe the Play Console (IARC) mandatory capability question wording into a `## Play Console (IARC)` section of `docs/compliance/age-rating-answers.md` and fill its own independent answer table — no row may refer the reader to the App Store Connect table for an answer (FR-007, FR-008, FR-013). Depends on T010
- [ ] T015 [US2] Add the location-sharing row to both store tables in `docs/compliance/age-rating-answers.md`, answered from research R-4: a task-evidence coordinate is stored on `collaboration.evidence_submission` and visible only to reviewers of that submission who hold `collab.reviewEvidence` and non-`viewer` membership of the project; a calendar check-in captures a coordinate and discards it; there is no feed, map or presence surface that shares a coordinate (FR-011). Depends on T013 and T014
- [ ] T016 [US2] Add the in-app browsing, purchases, advertising and mature-content rows to both tables in `docs/compliance/age-rating-answers.md`, answered from the dependency tree, with the browsing qualifier that colleague-posted links open in the system browser via `Linking.openURL` and no embedded browser renders third-party content (research R-7). Depends on T013 and T014
- [ ] T017 [US2] Write a `### Resulting rating` subsection under each store section of `docs/compliance/age-rating-answers.md`, naming the answers that drive the rating and carrying the `provisional — not yet confirmed against the live form` marker with its date until a submission confirms it (FR-012, SC-005). Depends on T013–T016
- [ ] T018 [US2] Write the `## Capabilities the app does not have` recorded-absence section of `docs/compliance/age-rating-answers.md`, naming biometric sign-in, background location and an embedded browser with their reasons, so no answer cell has to name them in running prose where the gate reads them as a live claim
- [ ] T019 [US2] Replace the `### Age rating` section of `docs/compliance/data-collection-inventory.md` (line ~120) with a one-line pointer to `age-rating-answers.md`, deleting the four sentences of answers so the repository holds age-rating answers in exactly one file (FR-015, SC-006)
- [ ] T020 [US2] Correct the Location row of the `## Collected data` table in `docs/compliance/data-collection-inventory.md` (line ~49): "where it is collected" becomes ritual task evidence only, because the calendar check-in path discards the coordinate and stores none (research R-4). Depends on T019 — same file
- [ ] T021 [US2] Add a drift-register entry to `docs/domain/README.md` recording that `frontend/apps/mobile/src/app/(app)/(calendar)/[eventId].tsx` requests foreground location permission and calls `getCurrentPositionAsync`, then discards the result and checks in with no coordinate, while `calendar.check_in` has no coordinate columns — recorded as drift, not fixed here (research R-4, Constitution XII)

**Checkpoint**: a submitter can fill in both questionnaires from the repository. US1 and US2
are both independently complete.

---

## Phase 5: User Story 3 - The next permission removal cannot leave the prose behind (Priority: P3)

**Goal**: the build fails when a compliance document names a device capability the app does
not declare, and names the document, the line and the term.

**Independent Test**: put the Face ID sentence back into `docs/compliance/reviewer-notes.md`
on a scratch edit and run `make check-store-manifest`; it must exit `1` and name the
document, the line number and `face id`.

### Implementation for User Story 3

- [ ] T022 [US3] Add `CAPABILITY_TERMS` (the twelve term → backing-declaration pairs in research R-6) and `RECORDED_ABSENCE_SECTIONS` (filename → declared heading texts, per [data-model.md](data-model.md) §2) as constants beside the existing allow-lists in `frontend/apps/mobile/scripts/check-store-manifest.js`, deriving "declared" from `ALLOWED_IOS_KEYS ∪ ALLOWED_ANDROID_PERMISSIONS` rather than introducing a second list (research R-1)
- [ ] T023 [US3] Implement the recorded-absence region parser in `frontend/apps/mobile/scripts/check-store-manifest.js` per the section grammar in [contracts/prose-gate.md](contracts/prose-gate.md): a section opens at `^(#{1,6})\s+<heading>\s*$` matched case-insensitively after trimming, includes its own heading line, closes at the next heading of the same or shallower level or at end of file, and is not closed by a deeper sub-heading. Export it and guard the script's top-level execution with `require.main === module` so requiring the file for the self-check does not run the gate
- [ ] T024 [US3] Implement section 4 of `frontend/apps/mobile/scripts/check-store-manifest.js` — the compliance-prose rule — after section 3: discover every `*.md` directly under `docs/compliance/` with `fs.readdirSync` rather than a hard-coded list, and for each line, for each matching capability term, pass if the term's declaration is in the declared set, pass if the line is inside a declared recorded-absence section of that document, otherwise `fail()` with the message format in [contracts/prose-gate.md](contracts/prose-gate.md) naming document, line, term, the unsatisfied declaration and this file's declared headings. Report each unsatisfied match separately (FR-016, FR-017, FR-018). Depends on T022 and T023
- [ ] T025 [US3] Create `frontend/apps/mobile/scripts/check-compliance-prose.check.js` as a dependency-free `assert`-based self-check asserting scenarios G2, G5 and G6 from [contracts/prose-gate.md](contracts/prose-gate.md) against in-memory document strings — a term inside a declared section passes, a deeper sub-heading does not close the section, a term on the first line after the closing heading fails — mirroring the `*.check.ts` convention in `frontend/apps/mobile/src/lib/`. Depends on T023
- [ ] T026 [US3] Run `make check-store-manifest` against the repository as it stands after US1, US2 and T024 and confirm it passes with no prose failures, in particular that the surviving biometric rows in `docs/compliance/permission-justifications.md` are not reported (scenario G4 and G2, FR-019, SC-008). Depends on T024, T009, T018
- [ ] T027 [US3] Verify the regression once per document (SC-007): on a scratch edit that is never committed, reinsert a biometric claim into `docs/compliance/reviewer-notes.md` outside `### Not requested`, into `docs/compliance/data-collection-inventory.md` outside `### Not collected`, and into `docs/compliance/age-rating-answers.md` outside `## Capabilities the app does not have`, running `make check-store-manifest` after each and confirming exit `1` with the document, line and term named, then reverting with `git checkout` (scenarios G1 and G3, FR-016, FR-018). Depends on T026
- [ ] T028 [US3] Update the `## Store manifest` section of `docs/domain/compliance-safety.md` to describe the gate's new compliance-prose rule, its capability vocabulary, the recorded-absence exemption and the failure format, so the snapshot no longer implies the gate's only document cross-check is the justifications file (FR-005, Constitution XII). Depends on T024

**Checkpoint**: the regression that produced this feature cannot recur silently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: run the quickstart end to end and confirm the feature's own success criteria.

- [ ] T029 [P] Run quickstart §1's capability grep over `docs/compliance/` and confirm every hit falls inside a declared recorded-absence section and none in running prose (SC-001)
- [ ] T030 [P] Run quickstart §2's one-copy check (`grep -rn "age rating" docs/compliance/ | grep -v age-rating-answers.md`) and confirm the only remaining hit is the pointer added in T019 (SC-006)
- [ ] T031 [P] Confirm `git diff main -- docs/compliance/permission-justifications.md` is empty, proving FR-003 was a verification and not an accidental edit
- [ ] T032 Walk quickstart §2's cold-reader procedure over `docs/compliance/age-rating-answers.md` with both questionnaires open: zero unanswered questions, zero escalations, and five Evidence cells spot-checked by following them (SC-003, SC-004)
- [ ] T033 Run `make test-mobile` and confirm the gate passes and the suite proceeds with no step bypassing it, and that the `Makefile` is unchanged in the diff (FR-019, SC-009). Depends on T026
- [ ] T034 Run quickstart §5's `git diff main -- docs/domain/compliance-safety.md docs/domain/README.md` and confirm the snapshot describes the corrected review materials and the new gate rule, the drift register gained the R-4 entry, and no entry describes behaviour this feature removed (FR-005, SC-009)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup; blocks all three stories because each compares
  prose against the declared set
- **US1 (Phase 3)**: after Foundational. No dependency on US2 or US3
- **US2 (Phase 4)**: after Foundational. Independent of US1 in content; T019/T020 touch the
  same file as T006, so if US1 and US2 run concurrently those three tasks serialise
- **US3 (Phase 5)**: after Foundational for implementation (T022–T025), but its *verification*
  tasks (T026, T027) require US1 and US2 to be done — the gate fails on documents US1 has not
  yet corrected, and scenario G1/G3 verification needs the `### Not requested` and
  `## Capabilities the app does not have` sections that US1 and US2 create
- **Polish (Phase 6)**: after all three stories

### User Story Dependencies

- **US1 (P1)**: independent. Shippable alone as the MVP
- **US2 (P2)**: independent of US1 and US3 in content; shares two files with US1
- **US3 (P3)**: implementable independently; verifiable only once US1 and US2 land, which is
  the correct order — the gate asserts the property US1 establishes

### Within Each User Story

- US1: reviewer-notes edits (T004 → T005) are sequential; the inventory edit (T006) and the
  justifications verification (T007) are parallel to them; the sweep (T008) follows all
  three; the snapshot update (T009) follows the sweep
- US2: skeleton (T010) first, then the two narrative sections and the two store tables in
  parallel, then the rows that span both tables (T015, T016), then the ratings (T017)
- US3: constants (T022) → parser (T023) → rule (T024), with the self-check (T025) parallel to
  the rule once the parser exists, then verification

### Parallel Opportunities

- T002 runs alongside T001
- Within US1: T006 and T007 run in parallel with the T004 → T005 chain
- Within US2: T011, T012, T013 and T014 all run in parallel once T010 exists — four different
  sections of one file, so they parallelise only if authors coordinate on the file, otherwise
  treat them as a fast sequence
- Within US3: T025 runs in parallel with T024 once T023 exists — different files
- In Polish: T029, T030 and T031 are three independent read-only commands

---

## Parallel Example: User Story 2

```bash
# After T010 creates the skeleton, four sections can be drafted independently:
Task: "Write the workspace boundary section (T011)"
Task: "Write the safeguards section (T012)"
Task: "Transcribe and fill the App Store Connect table (T013)"
Task: "Transcribe and fill the Play Console table (T014)"
```

## Parallel Example: User Story 3

```bash
# After T023 exports the region parser:
Task: "Implement section 4 of check-store-manifest.js (T024)"
Task: "Write check-compliance-prose.check.js (T025)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3: US1 — six tasks, two documents and one snapshot
3. **STOP and VALIDATE**: run quickstart §1. The review packet no longer names an
   unfindable capability, which is the live rejection risk
4. This is shippable on its own and closes the highest-cost failure in the spec

### Incremental Delivery

1. Setup + Foundational → the declared set is fixed
2. US1 → the prose stops over-promising → shippable
3. US2 → the questionnaire can be answered → submission unblocked
4. US3 → the recurrence is prevented → verified against US1's and US2's documents
5. Polish → quickstart end to end

### Parallel Team Strategy

US1 and US2 are two writers on largely disjoint text; US3 is the only code, so it can run
concurrently with both and simply verify last. The one coordination point is
`docs/compliance/data-collection-inventory.md`, which US1 (T006) and US2 (T019, T020) both
edit in different sections.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task
- The feature changes no app behaviour. Anything the honest questionnaire answers reveal
  about the app goes into the drift register (T021), not into a code fix here
- `docs/compliance/permission-justifications.md` must end the feature byte-identical to
  `main` (T007, T031)
- Commit after each logical group; the checkpoints are the natural commit boundaries
