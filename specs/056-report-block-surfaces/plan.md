# Implementation Plan: Report and Block Wherever User Content Appears

**Branch**: `056-report-block-surfaces` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/056-report-block-surfaces/spec.md`

## Summary

Mount controls that already exist on screens that do not have them. Six client files,
one API wrapper, no backend.

The safety system is complete underneath: `ReportContent` accepts five target kinds and
resolves the author and snapshot server-side for each, and `BlockPerson` /
`UnblockPerson` / `ListBlockedPeople` are unchanged and already granted to Employee.
What is missing is the doorway. This feature adds:

- **Report and Block rows to the mobile thread action sheet**, mounting the existing
  `ReportSheet` and `BlockConfirm` components — the thread is the largest body of
  content in the product with no report control at all.
- **Block / Unblock to the mobile person profile**, decided from the signed-in
  person's own block list through the query key the channel screen already uses, so
  the control flips in place after confirming.
- **A Report button beside Download** on the mobile file list row and file detail
  screen, and a flag button in the web files table's Actions column.
- **A report control on each web document comment** the reader did not write.

Two corrections surfaced while reading the code and are folded in, because both are
in lines this feature already has to touch:

1. `getMessageById` in `apis` is the one channel-returning wrapper that does not map
   `channelType` through `convertChannelType`, so it hands screens a raw proto enum.
   The thread needs that field to pick `direct_message` vs `chat_message` (FR-002),
   and comparing an enum number in a screen is what Principle VIII forbids. Fixed in
   the wrapper (research [R-2](research.md)).
2. The channel screen offers "Block this person" on **system** rows, because it
   assumes a system message has no author and the backend writes the acting employee
   into `author_employee_id`. The spec's edge case and FR-003 both say it should not.
   The predicate is corrected on both screens, not copied into a second one
   (research [R-4](research.md)).

No proto, no migration, no permission, no RPC. The spec's assumption that planning
should surface any backend need was checked first and found to hold.

## Technical Context

**Language/Version**: TypeScript 5 / React 19. React Native + Expo Router (mobile),
Next.js App Router + MUI v7 (web). No Go, SQL or proto changes.

**Primary Dependencies**: none added. `@tanstack/react-query` (already used on every
screen touched), `apis` workspace package, existing `ReportSheet` / `BlockConfirm` /
`ReportContentDialog` components.

**Storage**: N/A. No migration, no `schema.sql` regeneration, no `sqlc` run.

**Testing**: `go test ./integration/...` (four new scenario groups in
`compliance_report_test.go`), `pnpm --filter web exec playwright test` (extending
`compliance-report.spec.ts`), `make test-mobile` (three new Maestro flows). The whole
of each suite must pass, not only the new tests.

**Target Platform**: iOS and Android (Expo, verified on both — the mobile controls are
buttons and action-sheet rows on narrow layouts), and the web client.

**Project Type**: mobile + web client feature against an unchanged Go backend.

**Performance Goals**: no new network call on any screen's render path. The profile's
block-list query shares `["compliance","blocked-people"]` with the channel screen, so
it is usually a cache read; the thread reads `channelType` from a response it already
fetches.

**Constraints**:
- One report form and one block confirmation per client, after as before (FR-018,
  SC-003).
- Every new control reachable in three presses or fewer (FR-004, FR-011).
- No control may report success the server did not give, and none may close on
  failure (FR-019, SC-006).
- The profile shows no contact control until it knows which of Block/Unblock is
  correct — no guess-then-flip.
- Nothing may be added that tells a blocked person they were blocked (FR-010).

**Scale/Scope**: 6 client files edited, 1 API wrapper fixed, 1 channel-screen
predicate corrected, 3 Maestro flows added, 1 backend test file extended, 1 E2E spec
extended, 2 documents updated (`docs/compliance/reviewer-notes.md`,
`docs/domain/compliance-safety.md`). Roughly 8 report/block control instances across
2 clients.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution v5.20.0.

| Principle | Applies | Status |
|---|---|---|
| I. Data Governance & Multi-Tenancy | No | No schema, query, migration or pool change. Every write goes through an existing RPC that already pins `organization_id` from the auth context. |
| II. Scenario-First Integration & E2E Testing | Yes | **Pass, with one justified exclusion** — see below. Scenarios are in [contracts/test-scenarios.md](contracts/test-scenarios.md) and are the reviewable behavioural contract for this plan. |
| III. Two-Layer Service Architecture & Proto Authorization | No | No service, no handler, no proto. `compliance.reportContent` and `compliance.blockPerson` already declare their permissions. |
| IV. Cross-Domain Integration | No | The cross-domain calls this feature depends on (`compliance` → `chat`/`files`/`docs`) already exist as interfaces in `internal/compliance/resolvers.go` and are not modified. |
| V. Observability, Simplicity & YAGNI | Yes | **Pass.** Nothing is built that exists: the forms, the block list query, the error copy and the target-kind mapping are all reused. The one shared component *not* extracted (the two action-sheet rows) is argued in research R-3. |
| VI. Versioning & Breaking Changes | Yes | **Pass.** `getMessageById`'s return type changes shape. Both callers are in this repository and are updated in the same change set, which is how this project satisfies VI. |
| VII. Frontend API Wrapper Pattern & Type Safety | Yes | **Satisfied, and one violation repaired.** `getMessageById` stops being a bare `as` cast and maps its channel like every sibling wrapper. No screen calls a Connect client directly. |
| VIII. Cross-Stack Constant Synchronization | Yes | **Satisfied.** No new constant. `ChannelType`, `ReportTargetKind` and `ReportReason` are existing four-way-synchronised unions; this feature makes one more call site honour `ChannelType` instead of comparing a raw enum. |
| IX. UUID v7 & Nullable Cursor Pagination | No | No new list or cursor. |
| X. Structured Error Details | Yes | **Satisfied by reuse.** The controls surface `COMPLIANCE_REPORT_ALREADY_FILED` and `COMPLIANCE_REPORT_TARGET_NOT_FOUND` through the existing forms' error rendering. No new error reason, and no branching on message text. |
| XI. Distributed-First Architecture | No | No server component. |
| XII. Living Documentation & Architecture Docs | Yes | **Mandatory and satisfied.** `docs/domain/compliance-safety.md` gains the per-surface control map in the same change set, and its "web cannot block" gap is recorded in the drift register in `docs/domain/README.md`. `backend/docs/` needs no change — nothing architectural moves. |
| XIII. Mobile Application Design & Testing | Yes | **Pass.** Three Maestro flows are added for the three new mobile surfaces. Nothing administrative is added to mobile: reporting and blocking are things a worker does about their own experience, not workspace administration, and both are already mobile surfaces. Report *review* stays web-only. Controls are verified on Android as well as iOS. |

### Justified exclusion from Principle II

Principle II requires an intentional testing exclusion to be documented with
justification in the plan. One exclusion is taken:

**No new backend integration scenario for blocking (US2).** A block created from a
person's profile is byte-identical to one created from a message menu — the same RPC,
the same arguments, the same row. `backend/integration/compliance_block_test.go`
already covers recording, the silence FR-010 and SC-005 require, symmetry of refusal,
idempotence, shared-channel visibility, and unblocking. A new scenario would call the
same RPC a second time and assert the same facts. US2's new behaviour is entirely on
the client, and it is covered by `block-from-profile.yaml`, which asserts the control
flips to Unblock in place — the part only the mobile app has.

Every other User Story and user-observable requirement has a scenario; the mapping is
the traceability table in [contracts/test-scenarios.md](contracts/test-scenarios.md).

**Result**: PASS. Complexity Tracking is empty.

### Post-design re-check (after Phase 1)

Re-evaluated once `research.md`, `data-model.md`, both contracts and `quickstart.md`
existed.

The design added no dependency, no component, no file on the client beyond the three
Maestro flows, and no server-side anything. Two obligations surfaced during design and
are folded into the same change set rather than deferred: the `getMessageById` mapping
(Principle VII and VIII, research R-2) and the system-message block predicate
(research R-4). Both make an existing principle *more* satisfied than at HEAD.

One judgement was re-examined under Principle V: whether the two duplicated
action-sheet rows should be extracted into a shared component. They should not —
extracting them means moving `makeStyles` definitions out of a 2,500-line screen this
feature otherwise only reads, for a drift risk already covered by identical `testID`s
and a flow that presses them. Recorded in research R-3 rather than left implicit.

**Still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/056-report-block-surfaces/
├── plan.md                       # This file
├── research.md                   # Phase 0 output — 11 findings, incl. the two corrections
├── data-model.md                 # Phase 1 output — no persisted change; client types and derived state
├── quickstart.md                 # Phase 1 output — how to prove it works
├── contracts/
│   ├── surface-controls.md       # Every control, its test id, target kind, subject label and visibility rule
│   └── test-scenarios.md         # The Principle II behavioural contract
├── spec.md
└── tasks.md                      # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/packages/apis/src/
└── chat.ts                                   # EDIT — getMessageById maps its channel through
                                              #        convertChannelType (research R-2)

frontend/apps/mobile/src/app/(app)/
├── (chat)/thread/[messageId].tsx             # EDIT — Report + Block rows in ThreadMessageActionSheet;
│                                             #        mount ReportSheet and BlockConfirm; widen the
│                                             #        local ThreadReply/channel interfaces (US1)
├── (chat)/[channelId].tsx                    # EDIT — one clause: no Block on a system row (research R-4)
├── (more)/people/[employeeId].tsx            # EDIT — Block/Unblock control driven by listBlockedPeople (US2)
├── (more)/files/index.tsx                    # EDIT — Report button beside Download on each row (US3)
└── (more)/files/[fileId].tsx                 # EDIT — Report button beside Download (US3)

# (shared)/resource/chat/thread/[messageId].tsx re-exports the thread screen, so the
# "every route that shows a thread" half of FR-001 needs no second edit.

frontend/apps/web/src/app/workspace/
├── files/components/ManagementTab.tsx        # EDIT — report icon button per row + ReportContentDialog (US3)
└── docs/components/CommentsPanel.tsx         # EDIT — report icon button per foreign comment
                                              #        + ReportContentDialog (US4)

backend/integration/
└── compliance_report_test.go                 # EDIT — file, deleted-file, document-comment and
                                              #        thread-in-a-DM scenarios; seedFile helper

frontend/apps/web/e2e/
└── compliance-report.spec.ts                 # EDIT — comment and web-file scenarios

frontend/apps/mobile/.maestro/compliance/
├── report-thread-message.yaml                # NEW — US1 happy path
├── block-from-profile.yaml                   # NEW — US2 happy path, restores state
└── report-file.yaml                          # NEW — US3 happy path

docs/
├── compliance/reviewer-notes.md              # EDIT — name every surface a reviewer can report from,
│                                             #        and blocking from a profile (SC-004)
└── domain/
    ├── compliance-safety.md                  # EDIT — per-surface control map (Principle XII)
    └── README.md                             # EDIT — drift entry: web still cannot block
```

**Structure Decision**: no new directory, no new component, no new package. Every
control is added to the screen that already renders the content, and every control
opens a form that already exists in `components/compliance/` (mobile) or
`workspace/components/` (web). The one piece of shared logic that could have been
extracted — the two action-sheet rows — is deliberately duplicated, argued in research
R-3. The Maestro flows join the existing `compliance/` flow directory rather than
starting a new one.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
