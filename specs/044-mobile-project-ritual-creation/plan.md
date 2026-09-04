# Implementation Plan: Create Projects And Rituals On Mobile

**Branch**: `044-mobile-project-ritual-creation` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/044-mobile-project-ritual-creation/spec.md`

## Summary

Two purpose-built mobile create surfaces — a project form and a ritual-definition form —
plus archive/unarchive for a ritual, plus clearing the tour's web-only flag on the
`project` and `ritual` stops so they point at those surfaces. No new RPC, no new proto
message, no new table, no new permission.

The technical approach is entirely additive on the client. Everything the two forms need
already exists on the wire: `CreateProject` accepts name/key/description/visibility/
collaboration_mode, and `CreateRitualDefinition` already accepts
`repeated CreateEvidenceRequirementInput evidence_requirements` in the same call, which is
what makes FR-013's atomicity free. Three small non-mobile edits carry the rest:

1. **`packages/apis`** — `CreateRitualDefinitionParams` does not yet expose
   `evidenceRequirements` even though the request message has carried it since feature 022.
   Adding it is the FR-026 case, verbatim: "if a shared client wrapper cannot express what
   the existing request already accepts, the wrapper is what changes."
2. **`packages/validations`** — the project-key rule (`^[A-Z][A-Z0-9_]{0,9}$`, the
   `valid_project_key` CHECK constraint) is inlined in the web page today. Mobile needs the
   same rule; duplicating a regex across two clients is exactly what Principle VIII forbids,
   so it moves to the shared package and the web page consumes it from there.
3. **`internal/collaboration`** — a duplicate project key currently surfaces as a wrapped
   `pgx` unique-violation, i.e. an opaque Internal. US2 scenario 3 and FR-016 need a
   field-named refusal, so two sentinel errors join the existing `handleError` switch and
   reuse the `fieldViolation` helper already used for `procedure_document_id` and `title`.

Everything else is `apps/mobile`: two modal screens, an assignee picker, a recurrence
control, an evidence-requirement editor, archive/unarchive on the existing ritual screen,
route context for the tour, and Maestro flows.

## Technical Context

**Language/Version**: TypeScript 5.9 (mobile + shared packages), Go 1.24 (backend edit only)

**Primary Dependencies**: Expo SDK 55 / React Native 0.83 / Expo Router 55; TanStack Query
v5; `apis` + `rpc` + `@tech-office/theme-tokens` + `@tech-office/validations` workspace
packages; `zod` 4 (already a mobile dependency); ConnectRPC. **No new dependency is added.**

**Storage**: PostgreSQL via existing `collaboration.project`, `collaboration.ritual_definition`
and `collaboration.evidence_requirement` tables. No migration.

**Testing**: Maestro blackbox flows in `frontend/apps/mobile/.maestro/` (`make test-mobile`);
Go integration tests in `backend/integration/` against the `testWorld` harness
(`make test-integration`); `tsc` across the monorepo as the cross-stack drift guard.

**Target Platform**: iOS 16+ and Android 8+ phones in portrait. Verified at 360dp on both.

**Project Type**: Mobile client feature in a Go backend + Next.js web + Expo mobile monorepo.

**Performance Goals**: Project creation reachable in under 60s of user time (SC-002); a daily
ritual with one photo requirement definable and its first run visible in under 2 minutes
(SC-001). No new server load: `CreateRitualDefinition` already generates the first instances
inside its own transaction (feature 034), so FR-014 costs one extra client refetch.

**Constraints**: 360dp portrait minimum on Android and iOS (FR-024, SC-007); every added
interactive element carries a `testID` (Constitution XIII); no generated proto stub may be
imported by a UI file (Constitution VII); the recurrence and evidence controls must not
become a reflow of the web's five-section two-column editor.

**Scale/Scope**: 2 new mobile route files, ~4 new mobile components, 1 modified mobile
screen, 1 modified mobile hook, 1 modified mobile route map, 2 modified shared packages,
1 modified Go file + 1 Go test, 5 documentation files, 1 constitution amendment, 3 Maestro
flows.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Verdict | Note |
|---|---|---|
| I — Data governance & multi-tenancy | **PASS** | No new table, query or tenant boundary. Both creations run through existing `txn.WithTxn(ctx, s.TenantPool, …)` handlers whose org scoping is unchanged. |
| II — Scenario-first integration & E2E testing | **PASS with work** | FR-025 mandates Maestro happy paths for each surface. One backend integration test is added for the inline-`evidence_requirements` path, which only two existing call sites exercise. |
| III — Two-layer service + proto-level authz | **PASS** | No proto change, so no `access_control` change. `collab.createProject` and `collab.manageRitualDefinition` continue to gate at the interceptor; the project-owner/admin bar for rituals continues to be enforced in `ritual_logic.go`. The client mirrors both; it does not replace either. |
| IV — Cross-domain integration | **PASS** | No new cross-domain call. The ritual creation path's existing call into instance generation is untouched. |
| V — Observability, simplicity & YAGNI | **PASS** | The mobile forms collect a strict subset. No abstraction is introduced for a single consumer; the recurrence picker and evidence editor live beside the ritual screen, not in a shared library, until a second caller exists. |
| VI — Versioning & breaking changes | **PASS** | `evidenceRequirements` is optional on the wrapper params. The two shared-package moves are compile-checked across all three clients in one change set. |
| VII — Frontend API wrapper pattern & type safety | **PASS with work** | Every new mobile call goes through `apis`. `CreateRitualDefinitionParams` gains `evidenceRequirements`; no mobile file imports from `rpc`. |
| VIII — Cross-stack constant & type sync | **PASS with work** | The project-key regex must not be copied into a second client. It moves to `@tech-office/validations` and both clients import it; the DB CHECK constraint stays the authority the shared schema mirrors. |
| IX — UUID v7 / nullable cursor params | **N/A** | No new pagination and no new identifier generation. |
| X — Structured error details | **PASS with work** | FR-016 requires a field-named refusal. `key` violations (invalid format, taken) become `fieldViolation(…, "key", …)`, matching the `procedure_document_id` and `title` precedent in the same switch. The mobile forms read them with `fieldViolation()` from `apis`. |
| XI — Distributed-first architecture | **N/A** | No new background work, cache or coordination. |
| XII — Living documentation | **PASS with work** | FR-023: `docs/domain/workspace-navigation.md`, `docs/domain/rituals-tasks.md`, the drift register in `docs/domain/README.md` (D38), `specs/039-feature-tour/contracts/tour-content.md` and `specs/mobile-ui-design.md` §9 all state the absent capability today and all must change in this set. |
| XIII — Mobile design & testing | **VIOLATION until amended** | See Complexity Tracking. Principle XIII currently confines configuration to the web with a carve-out covering only first-run onboarding. FR-027 amends it. The amendment is task zero of implementation; shipping without it leaves the repository contradicting its own constitution. |

**Post-Phase-1 re-evaluation**: unchanged. The design added no new abstraction, no new
dependency, no new RPC and no new table. The three non-mobile edits are the minimum that
Principles VII, VIII and X each independently require; none is optional and none is
speculative. The only outstanding gate is the XIII amendment, tracked below.

## Project Structure

### Documentation (this feature)

```text
specs/044-mobile-project-ritual-creation/
├── plan.md                          # This file
├── spec.md
├── research.md                      # Phase 0 output
├── data-model.md                    # Phase 1 output
├── quickstart.md                    # Phase 1 output
├── contracts/                       # Phase 1 output
│   ├── mobile-surfaces.md           # Routes, testIDs, form behaviour
│   ├── api-wrapper-changes.md       # packages/apis + packages/validations delta
│   └── tour-content-delta.md        # Tour stop + route-map changes
├── checklists/
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── internal/collaboration/
│   ├── errors.go                    # + ErrProjectKeyTaken, ErrProjectKeyInvalid
│   ├── project_logic.go             # classify the unique-violation on create
│   └── connect.go                   # map both to fieldViolation(…, "key", …)
├── internal/tour/content.go         # clear WebOnly on the project + ritual stops
└── integration/
    ├── collaboration_ritual_test.go # + atomic inline evidence_requirements case
    ├── collaboration_project_test.go# + duplicate-key field violation case
    └── feature_tour_test.go         # mobile stop expectations move to people-only

frontend/
├── packages/validations/src/
│   ├── project-key.ts               # NEW — shared key rule + derivation
│   └── index.ts                     # re-export
├── packages/apis/src/
│   └── collaboration-ritual.ts      # CreateRitualDefinitionParams.evidenceRequirements
├── apps/web/src/app/workspace/projects/
│   └── page.tsx                     # consume the shared key rule
└── apps/mobile/
    ├── src/app/(app)/(tasks)/
    │   ├── _layout.tsx              # register the two modal screens
    │   ├── create-project.tsx       # NEW — project create modal
    │   ├── index.tsx                # permission-gated create affordance
    │   ├── [projectId]/
    │   │   ├── index.tsx            # role-gated "add a ritual" affordance
    │   │   └── create-ritual.tsx    # NEW — ritual create modal
    │   └── rituals/[definitionId].tsx  # archive / unarchive
    ├── src/components/rituals/
    │   ├── recurrence-picker.tsx    # NEW
    │   ├── evidence-requirement-editor.tsx  # NEW
    │   └── assignee-picker.tsx      # NEW
    ├── src/lib/
    │   ├── tour-routes.ts           # route the projects + rituals targets
    │   └── device-timezone.ts       # NEW — Intl → stored timezone string
    ├── src/hooks/use-feature-tour.ts# pass route context; expose the fallback flag
    ├── src/components/feature-tour.tsx  # render the fallback note
    └── .maestro/
        ├── projects/create-project.yaml     # NEW
        ├── rituals/create-ritual.yaml       # NEW
        ├── rituals/archive-ritual.yaml      # NEW
        └── feature-tour/owner-tour.yaml     # web-only assertions narrow to `people`

docs/domain/
├── README.md                        # close D38
├── workspace-navigation.md          # tour filtering: one web-only stop, not three
└── rituals-tasks.md                 # mobile now creates and archives definitions

specs/
├── mobile-ui-design.md              # §9 web-only table
└── 039-feature-tour/contracts/tour-content.md   # stop 2 and 3 lose their web-only block

.specify/memory/constitution.md      # Principle XIII amendment (FR-027)
```

**Structure Decision**: Existing monorepo layout, unchanged. The feature is a mobile client
addition (`frontend/apps/mobile`) resting on two shared workspace packages
(`frontend/packages/apis`, `frontend/packages/validations`) with one backend error-mapping
edit and one backend tour-content edit. There is no new module, app or package.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Constitution Principle XIII amendment (FR-027) | XIII confines administrative and configuration features to the web, with an exhaustive first-run-onboarding carve-out that names only "create an organization" and "create the first org-managed accounts". Project and ritual-definition creation fall outside it, so the feature as specified cannot ship against the current text. | *Ship without amending* leaves the code contradicting the constitution and makes the next reviewer's XIII check meaningless. *Abandon the feature* contradicts the owner's standing direction that mobile progressively gains the product's most important features and that the real line is administration versus day-to-day operation. The amendment is written narrowly — project and ritual-definition creation only; role editing, department management, member import, billing and quotas stay web-only — so the carve-out does not become a licence. |
| A backend edit in a feature whose FR-026 says "no new server capability" | A duplicate project key currently reaches the client as an opaque Internal from a wrapped `pgx` unique violation. US2 scenario 3 requires the person be told the identifier is taken, and Principle X requires that as a structured field violation, not a parsed message string. | *Parse the error text on the client* is exactly the string-matching Principle X exists to prevent, and would break on any Postgres message change. *Pre-check the key with a list call* is a TOCTOU race and an extra round trip on every save. The chosen fix adds two sentinel errors to an existing switch — no new RPC, no new field, no new permission — so FR-026's "no new capability" holds. |
