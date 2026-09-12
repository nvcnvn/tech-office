# Contract: the compliance-prose rule in `check-store-manifest.js`

**Feature**: 054 | Covers FR-016, FR-017, FR-018, FR-019 | Executable contract for US3,
and the mechanical half of US1 (see the Principle II exclusion in [../plan.md](../plan.md)).

This is section 4 of `frontend/apps/mobile/scripts/check-store-manifest.js`. It runs after
section 3 (the justifications cross-check) and shares that script's `fail()`/`failures`
mechanism, exit code and output format. It adds no dependency and no CLI flag.

---

## Inputs

| Input | Source |
|---|---|
| The documents to scan | every `*.md` directly under `docs/compliance/`, discovered with `fs.readdirSync` — not a hard-coded list, so a fifth compliance document is covered the day it is added |
| What counts as declared | `ALLOWED_IOS_KEYS ∪ ALLOWED_ANDROID_PERMISSIONS`, the constants already at the top of the script |
| The vocabulary | `CAPABILITY_TERMS`, a new constant beside them (research R-6) |
| The exemptions | `RECORDED_ABSENCE_SECTIONS`, a new constant mapping document filename → array of exact heading texts (data-model §2) |

## The rule

For each document, for each line, for each capability term whose lower-cased `term` is a
substring of the lower-cased line:

1. If the term's `declaration` is in the declared set → **pass**. The app has the
   capability; describing it is the documents' job.
2. Otherwise, if the line is inside a declared recorded-absence section of that document →
   **pass**. The absence is recorded, which is the opposite of a false promise (FR-017).
3. Otherwise → **fail**, with the message below (FR-016, FR-018).

A line may match more than one term; each unsatisfied match is reported separately, so one
edit does not have to be made twice to see the second problem.

## Section grammar

A recorded-absence section begins at a line matching `^(#{1,6})\s+<heading>\s*$` where
`<heading>` is one of the document's declared headings, compared after trimming and
case-insensitively. It ends at the first subsequent line matching `^#{1,N}\s` where `N` is
the opening heading's level — that is, the next heading of the same or shallower depth — or
at end of file.

Consequences worth stating, because they are the cases that decide the rule's behaviour:

- A deeper sub-heading **inside** a recorded-absence section does not close it. A
  `#### NSFaceIDUsageDescription` under `### Keys deliberately absent` stays exempt.
- The heading line itself is inside the section.
- A declared heading that does not appear in the document is not an error. It means the
  document has no absences to record yet.
- The section list is by filename, not by path glob. A heading named `Not collected` in a
  document that has not declared it is not exempt.

## Failure message format (FR-018)

```
docs/compliance/<file>:<line>: "<term>" names a capability the app does not declare
(<declaration> is not in the allowed set). Either the app must declare it, or the sentence
must move into a recorded-absence section (<declared headings for this file, or "none
declared for this file">).
```

Concretely, for the regression this feature exists to prevent:

```
docs/compliance/reviewer-notes.md:141: "face id" names a capability the app does not declare
(NSFaceIDUsageDescription is not in the allowed set). Either the app must declare it, or the
sentence must move into a recorded-absence section (Not requested).
```

Three things are named — document, line, term — which is FR-018's requirement, plus the
declaration and the way out, so the fix does not require reading the script.

## Exit behaviour

Unchanged from the rest of the script: failures accumulate into `failures`, are printed
together under `store manifest check FAILED (n problems)`, and the process exits `1`. A
clean run prints `store manifest check passed`. The `notes` mechanism (used for
"AndroidManifest.xml not found") is not used by this rule — every input it needs is in the
repository, so it never runs in a degraded mode.

---

## Scenarios

Executed by `make check-store-manifest` (G1–G4, G7) and by the region-parser self-check
`frontend/apps/mobile/scripts/check-compliance-prose.check.js` (G2, G5, G6), which asserts
against in-memory document strings rather than mutating tracked files.

| # | Given | When | Then | FR |
|---|---|---|---|---|
| **G1** | `reviewer-notes.md` with the Face ID clause restored to the permissions paragraph | the gate runs | fails, naming the document, the line and `face id` | FR-016, FR-018, SC-007 |
| **G2** | the biometric rows in `permission-justifications.md`'s *Permissions deliberately blocked* and *Keys deliberately absent* tables as they stand at HEAD | the gate runs | passes — no failure mentions either row | FR-017, SC-008 |
| **G3** | `data-collection-inventory.md` with the old sentence "Face ID and fingerprint sign-in are performed by the operating system…" restored | the gate runs | fails on that line | FR-016, SC-007 |
| **G4** | the repository at the end of this feature | `make check-store-manifest` runs | passes | FR-019, SC-009 |
| **G5** | a capability term inside a declared section, followed by a deeper sub-heading, followed by the same term still inside that section | the rule runs | both mentions pass; the sub-heading did not close the section | FR-017 |
| **G6** | a capability term on the first line after the section's closing heading | the rule runs | fails; the section ended at the heading | FR-016 |
| **G7** | `NSFaceIDUsageDescription` added to `ALLOWED_IOS_KEYS` and a Face ID sentence written into the reviewer notes | the gate runs | the prose rule passes on that sentence — a declared capability may be described. (The rest of the script still fails the run, because `FORBIDDEN_IOS_KEYS` and the `faceIDPermission: false` assertion contradict the addition. That contradiction is the pre-existing design and is out of scope; the scenario asserts only that the prose rule itself is keyed on the allow-list.) | FR-016 |

## What this rule deliberately does not do

- It does not parse English. A sentence describing an unimplemented capability in words
  outside the vocabulary passes. The vocabulary covers what a reviewer recognises by name,
  and the spec's assumption is explicit that anything cleverer is a natural-language
  problem dressed as a build step.
- It does not scan outside `docs/compliance/`. Generalised prose linting is out of scope.
- It does not check code fences or front matter separately. No compliance document has a
  capability term inside a fence, and adding fence tracking to guard against a case that
  does not exist would be the kind of speculative machinery this feature is removing.
