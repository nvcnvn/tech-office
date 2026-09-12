# Implementation Plan: Compliance prose describes the app that exists, and the age rating answers the questions now asked

**Branch**: `054-compliance-prose-age-rating` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/054-compliance-prose-age-rating/spec.md`

## Summary

Three compliance documents and one build script. Remove the two live claims about a
biometric sign-in that does not exist (`reviewer-notes.md`, `data-collection-inventory.md`),
verify the third document already has none (`permission-justifications.md`, which
feature 053 already converted to recorded-absence entries), add one new document
answering both stores' age-rating questionnaires with cited evidence, and extend the
existing `check-store-manifest.js` gate with a prose rule so the next permission
removal cannot leave the prose behind.

The technical approach is deliberately small: the gate already reads every relevant
input — `app.json`, the generated native manifests, and
`docs/compliance/permission-justifications.md` — and already owns the allow-lists that
define what the app declares. The new rule is a loop over `docs/compliance/*.md` inside
that script, matching a fixed capability vocabulary against those same allow-lists, with
one exemption mechanism: a declared **recorded-absence section**. No new dependency, no
new script, no natural-language parsing.

## Technical Context

**Language/Version**: Markdown (the four documents); Node.js ≥ 20, dependency-free
CommonJS (the gate). No Go, TypeScript, SQL or proto changes.

**Primary Dependencies**: none added. The gate uses `fs` and `path` only, and this
feature keeps it that way.

**Storage**: N/A — no schema change, no migration.

**Testing**: `make check-store-manifest` (→ `node frontend/apps/mobile/scripts/check-store-manifest.js`),
which is already a prerequisite of `make test-mobile`. The new prose rule additionally
gets one runnable self-check following the repo's existing `*.check.ts` convention
(`frontend/apps/mobile/src/lib/doc-rows.check.ts` and siblings), because the
region-boundary logic is a small parser and a parser without a check is unfinished.

**Target Platform**: the build (macOS and Linux CI), plus the two store consoles as the
human consumer of the documents.

**Project Type**: documentation change plus one build-time check. No runtime code.

**Performance Goals**: the gate stays well under a second. It reads four markdown files
of a few kilobytes each in addition to what it already reads.

**Constraints**:
- No behaviour of the app changes (spec assumption). Anything the honest answers reveal
  about the app is recorded as drift, not fixed here.
- The documents stay paste-ready: `reviewer-notes.md` is pasted verbatim into App Store
  Connect and Play Console, so its structure may gain a heading but must not gain
  repository-internal apparatus a reviewer would not understand.
- No new dependency and no new script file for the gate rule — it belongs inside the
  script that already owns the allow-lists, or the allow-lists become two.

**Scale/Scope**: 3 compliance documents edited, 1 created, 1 domain snapshot updated,
1 gate script extended, 1 self-check added, 1 drift register entry.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution v5.20.0.

| Principle | Applies | Status |
|---|---|---|
| I. Data Governance & Multi-Tenancy | No | No schema, query, migration or pool usage changes. |
| II. Scenario-First Integration & E2E Testing | Partially | **See justified exclusion below.** |
| III. Two-Layer Service Architecture | No | No service, no RPC, no proto. |
| IV. Cross-Domain Integration | No | No new cross-domain call. |
| V. Observability, Simplicity & YAGNI | Yes | **Pass.** The recurrence guard is a rule inside a script that already runs, reading files it already reads. No new infrastructure, no new dependency, no new CI step. |
| VI. Versioning & Breaking Changes | No | No API or client contract. |
| VII. Frontend API Wrapper Pattern | No | No API surface touched. |
| VIII. Cross-Stack Constant Synchronization | No | The capability vocabulary is build-time only and has no runtime counterpart to mirror. It is derived from the allow-lists already in the same file, so it cannot drift from them across a file boundary. |
| IX. UUID v7 & Nullable Cursor Pagination | No | No data access. |
| X. Structured Error Details | No | No gRPC errors. The gate's failure format is covered by FR-018 and specified in [contracts/prose-gate.md](contracts/prose-gate.md). |
| XI. Distributed-First Architecture | No | No runtime component. |
| XII. Living Documentation & Architecture Docs | Yes | **Mandatory and satisfied.** `docs/domain/compliance-safety.md` is updated in the same change set (FR-005), covering both the corrected review materials and the gate's new rule. `backend/docs/` needs no change — nothing architectural moves. |
| XIII. Mobile Application Design & Testing | Yes | **Pass.** No mobile UI, screen or flow changes, so no Maestro flow is added. `make test-mobile` must pass at the end with the gate enabled and no bypass (FR-019, SC-009). |

### Justified exclusion from Principle II (Scenario-First Testing)

Principle II requires every User Story and user-observable Requirement to be covered by
a backend integration scenario, and every UI-visible behaviour by a Playwright E2E
scenario, and requires an intentional exclusion to be documented with justification in
the plan. This feature is excluded, with the following justification and the following
substitute contract.

**Why excluded**: there is no backend behaviour and no UI behaviour in this feature. US1
and US2 change only prose that humans read in a store console; nothing observable through
an RPC or a browser changes. Writing an integration test would mean asserting on the text
of a markdown file from Go, which puts the assertion further from the thing it guards than
the gate that already reads that file at build time.

**What replaces it**: US3 *is* the executable contract for US1 — the gate mechanically
asserts the property US1 establishes, and does so on every build rather than once.
The behavioural contract for this feature is therefore
[contracts/prose-gate.md](contracts/prose-gate.md), whose scenarios map to FR-016
through FR-019 and are executed by `make check-store-manifest` plus the region-parser
self-check. US2 has no executable contract and cannot have one — its acceptance is a
human completing a form (SC-003), so it is verified by the review-and-walkthrough
procedure in [quickstart.md](quickstart.md).

**Traceability**:

| User Story / FR | Covered by |
|---|---|
| US1, FR-001…FR-004 | Gate scenarios G1–G4 in [contracts/prose-gate.md](contracts/prose-gate.md), plus quickstart §1 |
| FR-005 | Quickstart §4 (domain snapshot review) |
| US2, FR-006…FR-015 | Document contract in [contracts/age-rating-answers.md](contracts/age-rating-answers.md), verified by quickstart §2 (cold-reader walkthrough) |
| US3, FR-016…FR-019 | Gate scenarios G1–G7, the region-parser self-check, and `make test-mobile` |

**Result**: PASS. No violation requires an entry in Complexity Tracking.

### Post-design re-check (after Phase 1)

Re-evaluated against the same principles once `research.md`, `data-model.md`, the two
contracts and `quickstart.md` existed. The design added no dependency, no script, no
directory and no runtime component; the one new constant pair (`CAPABILITY_TERMS`,
`RECORDED_ABSENCE_SECTIONS`) lives beside the allow-lists it is derived from, so
Principle VIII stays inapplicable rather than newly satisfied. Principle V is
strengthened by the design rather than strained: the rejected alternative in research R-5
(negation detection) was the one that would have added cleverness, and it was dropped.
One new obligation surfaced during design — the drift register entry for the discarded
calendar check-in coordinate (research R-4) — which is Principle XII work and is folded
into the same change set. **Still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/054-compliance-prose-age-rating/
├── plan.md                          # This file
├── research.md                      # Phase 0 output
├── data-model.md                    # Phase 1 output
├── quickstart.md                    # Phase 1 output
├── contracts/
│   ├── prose-gate.md                # The gate's rule, vocabulary, exemption grammar and failure format
│   └── age-rating-answers.md        # Required structure of the new compliance document
├── spec.md
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
docs/compliance/
├── reviewer-notes.md                # EDIT — drop the Face ID clause from the permissions
│                                    #        paragraph; add a "Not requested" recorded-absence
│                                    #        section that absorbs the existing background-location
│                                    #        sentence (FR-001)
├── data-collection-inventory.md     # EDIT — rewrite the biometric line under "Not collected"
│                                    #        (FR-002); replace the "Age rating" section with a
│                                    #        pointer (FR-015); correct the location row's
│                                    #        "where it is collected" (research finding R-4)
├── permission-justifications.md     # VERIFY ONLY — already correct at HEAD (FR-003)
└── age-rating-answers.md            # NEW — both stores' questionnaires (FR-006…FR-014)

docs/domain/
├── compliance-safety.md             # EDIT — review materials and the gate's new rule (FR-005)
└── README.md                        # EDIT — drift register entry for the discarded
                                     #        calendar check-in coordinate (research R-4)

frontend/apps/mobile/scripts/
├── check-store-manifest.js          # EDIT — section 4: the compliance-prose rule (FR-016…FR-018)
└── check-compliance-prose.check.js  # NEW — assert-based self-check for the region parser
```

**Structure Decision**: no new directory and no new top-level component. The compliance
documents keep their one-file-per-store-form-family convention (`reviewer-notes` for the
review notes field, `permission-justifications` for the permission declarations,
`data-collection-inventory` for the two privacy forms), and the age-rating answers become
the fourth member of that family rather than a subsection of a document scoped to a
different form. The gate rule lives in the script that already owns the allow-lists it
must compare against; splitting it out would create the second source of truth this
feature exists to prevent. The self-check sits beside the script it checks, mirroring the
`*.check.ts` files already in `frontend/apps/mobile/src/lib/`.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
