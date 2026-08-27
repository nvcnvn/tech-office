# Implementation Plan: App Store & Google Play Compliance Sweep

**Branch**: `036-store-compliance-sweep` | **Date**: 2026-08-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/036-store-compliance-sweep/spec.md`

## Summary

Six independently shippable slices that make a first submission to App Store Review and
Google Play Review survivable: self-serve account deletion, a published legal surface with
acceptance at signup, content reporting and person blocking, an honest permission manifest,
a reviewer-usable demo workspace, and a maintained data-collection inventory feeding both
stores' privacy forms.

The central technical insight, which shapes almost everything else, is that **the same UUID
identifies a person at all three layers** — `iam.user.id`, `iam.identity.id` and
`organization.employee.id` are the same value (confirmed by `GetUserRoleNamesInOrg`, which
joins `iam.employee_role.employee_id` against a user id). That makes membership enumeration
and the two deletion paths tractable without a new mapping table.

The second insight is that **deletion is anonymisation at the tenant layer and destruction at
the global layer**. Roughly fifty columns across a dozen schemas reference an employee id, and
Citus forbids `ON DELETE SET NULL`, so a cascade-based erase is neither available nor
desirable. Instead the `organization.employee` row survives as a de-identified tombstone —
which is precisely what FR-006 asks for — while `iam.user` and everything hanging off it is
destroyed. One `UPDATE` plus a handful of targeted `DELETE`s replaces a fifty-table sweep.

New surface: a `compliance` schema (already declared in `schema.sql`, currently empty), an
`internal/compliance` package, and `rpc/v1/compliance.proto`. Reporting spans chat, files,
documents and calls, so it cannot live inside any one of those domains; cross-schema joins are
forbidden, so it composes them through service calls.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x (web + mobile)

**Primary Dependencies**: Connect RPC + protobuf, sqlc, pgx, Citus-distributed PostgreSQL;
Next.js 15 (web, `output: "standalone"`); Expo SDK 55 / React Native 0.83 / Expo Router
(mobile); `expo-web-browser` (already present — used to open the legal pages rather than
duplicating them in the app)

**Storage**: PostgreSQL with Citus. New tenant tables in the `compliance` schema; two new
columns on the global, non-distributed `iam.user`.

**Testing**: `go test ./integration/...` (testWorld pattern), Playwright in
`frontend/apps/web/e2e/`, Maestro in `frontend/apps/mobile/.maestro/`

**Target Platform**: iOS 15+, Android 8+ (Play targetSdk floor met by Expo 55), modern browsers

**Project Type**: Mobile + web clients over a Go RPC backend

**Performance Goals**: Reporting and blocking are interactive — under 300 ms server-side.
Account deletion is a background operation with no interactive latency target; the person is
signed out immediately and the erase completes asynchronously.

**Constraints**:
- Citus: every new tenant table needs `organization_id` first in the primary key and in every
  unique index; foreign keys must reference composite keys; no triggers; no `ON DELETE SET
  NULL`; no `now()` inside `ON CONFLICT DO UPDATE`.
- Enumerating a person's organizations means querying `iam.identity` by `id` alone, which is
  cross-shard. Acceptable only because deletion is rare; requires `AdminPool` with written
  justification (Principle I).
- Constitution XIII restricts mobile to non-administrative surfaces. Reporting, blocking,
  self-deletion and requesting one's own removal are personal and belong on mobile; reviewing
  reports and approving removals are administrative and are web-only.
- Store review calendars are external and unforgiving: the demo credentials must survive
  multiple weeks, which rules out the 3-day temporary PIN expiry for the demo worker account.

**Scale/Scope**: 4 new tables, 2 new columns, ~14 new RPCs, 2 new public web pages, 6 mobile
screens or sheets, 1 web admin page, 1 CI manifest check, 1 seed command.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design.*

| Principle | Verdict | How this design satisfies it |
|---|---|---|
| **I. Data governance & Citus** | PASS | All four new tables are tenant tables with `PRIMARY KEY (organization_id, id)` and composite FKs. No triggers; state changes are application code. Deletion uses explicit `UPDATE`s rather than `ON DELETE SET NULL`, which Citus forbids anyway. The one cross-shard read (`iam.identity WHERE id = $1`) is justified in [research.md](research.md#r5) and confined to the deletion path on `AdminPool`. |
| **II. Scenario-first testing** | PASS — gated | Scenario stubs for all six stories and all 44 FRs are enumerated in [contracts/test-scenarios.md](contracts/test-scenarios.md). **This is the behavioural contract and must be approved before `/speckit-tasks`.** Three FRs are documented there as excluded from automated coverage with justification (they are store-submission artifacts, not running code). |
| **III. Two-layer service + proto authorization** | PASS | `internal/compliance` splits `logic.go` (business rules, DBTX-taking) from `connect_*.go` (transport). Every RPC carries `rpc.v1.access_control`. New permissions follow the existing `domain.action` convention: `compliance.reportContent`, `compliance.blockPerson`, `compliance.reviewReports`, `compliance.manageRemovalRequests`. The first two are granted to every role including Employee; the latter two to Owner and Operator only. |
| **IV. Cross-domain integration** | PASS | A report can target a chat message, a file, a document comment or a call record. `internal/compliance` never joins across schemas — it stores a denormalised content snapshot at report time and calls the owning domain's service for anything live. Snapshotting also satisfies FR-018 (a report outlives deletion of its subject). |
| **V. Observability, simplicity & YAGNI** | PASS | Automated content filtering, moderation queues with SLAs, and an appeals process are explicitly out of scope and recorded in the spec's Assumptions. Blocking is two chokepoints, not a filter threaded through every read path. |
| **VI. Versioning & breaking changes** | PASS | Additive on the backend. The Android permission removals and iOS `Info.plist` changes are breaking at the build level but ship atomically across backend, web and mobile in one change set, consistent with the project's no-backward-compatibility stance. |
| **VII. Frontend API wrapper & type safety** | PASS | New `frontend/packages/apis/src/compliance.ts` following the existing wrapper pattern; no direct client construction in components. |
| **VIII. Cross-stack constant sync** | ATTENTION | Three new enumerations — report reason, report outcome, removal-request status — each need the SQL `CHECK`, Go constants, proto enum and TypeScript type kept in lockstep. Called out as its own task rather than folded into the table work, because this is the principle most often violated by accident. |
| **IX. UUID v7 & nullable cursor pagination** | PASS | All new ids are `uuidv7()`. Report listing pages on `(organization_id, id DESC)` with a nullable cursor, matching the pattern already used by `ListMessages`. |
| **X. Structured error details** | PASS | Refusing deletion for a sole owner (FR-005) returns a structured detail naming the blocking organizations, so the client can render the transfer-or-close path instead of a bare string. Extends the existing `iam_error_details.proto`. |
| **XI. Distributed-first & horizontal scalability** | PASS | Deletion is enqueued on the existing background queue and driven by an `account_deletion` record with an explicit state, so a partial failure is detectable and resumable (spec edge case) rather than leaving a half-erased person. |
| **XII. Living documentation** | PASS — gated | A new `docs/domain/compliance-safety.md`, plus updates to `auth-identity.md`, `chat.md`, `voice.md` and the `docs/domain/README.md` index. Part of Definition of Done, enforced by the mandatory `speckit.docs.snapshot` hook after implementation. |
| **XIII. Mobile design & testing** | PASS | Mobile gets report, block, block list, self-deletion and removal request — all personal actions. Report review and removal approval are web-only, respecting the feature-scope rule. Maestro flows cover report and block. |

**No violations requiring justification.** The Complexity Tracking table is therefore omitted.

Two gates remain open and are the reason this command stops at Phase 1:

1. The behavioural contract in [contracts/test-scenarios.md](contracts/test-scenarios.md) needs
   sign-off before `/speckit-tasks`.
2. Principle VIII's four-way constant synchronisation is a known trap; the task breakdown must
   keep it as one atomic task per enumeration.

## Project Structure

### Documentation (this feature)

```text
specs/036-store-compliance-sweep/
├── spec.md                       # Feature specification (approved)
├── plan.md                       # This file
├── research.md                   # Phase 0 — design decisions and rejected alternatives
├── data-model.md                 # Phase 1 — tables, columns, state machines
├── quickstart.md                 # Phase 1 — how to run and validate the feature
├── contracts/
│   ├── compliance.proto.md       # RPC surface for the new service
│   ├── iam-deletion.proto.md     # Additions to the existing IAM surface
│   └── test-scenarios.md         # Behavioural contract (Principle II gate)
├── checklists/
│   └── requirements.md           # Spec quality checklist (all passing)
└── tasks.md                      # Created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   ├── compliance.proto                      # NEW — reports, blocks, removal requests
│   ├── iam.proto                             # DeleteMyAccount, AcceptTerms, GetAccountDeletionPath
│   └── iam_error_details.proto               # SoleOwnerBlocksDeletion detail
├── database/scripts/
│   ├── schema.sql                            # compliance.* tables; iam.user terms columns
│   └── compliance.query.sql                  # NEW — sqlc source for the new domain
├── k8s/base/database/migrations/
│   └── 20260827000001_store_compliance.up.sql   # NEW
├── internal/
│   ├── compliance/                           # NEW — logic.go, connect_*.go, constants.go
│   └── iam/                                  # deletion logic, terms acceptance
├── integration/
│   ├── compliance_report_test.go             # NEW
│   ├── compliance_block_test.go              # NEW
│   └── iam_account_deletion_test.go          # NEW
└── cmd/tools.go                              # seed-demo-org subcommand

frontend/
├── packages/apis/src/
│   └── compliance.ts                         # NEW — wrapper for the new service
├── apps/web/
│   ├── src/app/privacy/page.tsx              # NEW — public, no auth
│   ├── src/app/terms/page.tsx                # NEW — public, no auth
│   ├── src/app/workspace/settings/           # account deletion; report review; removal queue
│   └── e2e/
│       ├── compliance-report.spec.ts         # NEW
│       ├── compliance-block.spec.ts          # NEW
│       └── account-deletion.spec.ts          # NEW
└── apps/mobile/
    ├── app.json                              # permission strings, blockedPermissions, POST_NOTIFICATIONS
    ├── scripts/check-store-manifest.js       # NEW — CI guard for FR-026/FR-029
    ├── src/app/(app)/(more)/settings.tsx     # legal links, blocked list, delete account
    ├── src/components/compliance/            # NEW — report sheet, block confirm
    └── .maestro/compliance/                  # NEW — report and block flows

docs/
├── domain/compliance-safety.md               # NEW — living snapshot for this domain
└── compliance/
    ├── data-collection-inventory.md          # NEW — source for both stores' privacy forms
    ├── permission-justifications.md          # NEW — pasteable into submission forms
    └── reviewer-notes.md                     # NEW — demo credentials and sign-in paths
```

**Structure Decision**: The existing backend layout (schema-per-domain, `internal/<domain>`,
one proto per domain, sqlc-generated queries) is followed exactly — a new domain is added
rather than compliance concerns being scattered into `chat`, `files`, `docs` and `voice`. The
`compliance` schema name is not invented; it is already declared in `schema.sql` and has been
empty until now. Legal pages are ordinary Next.js routes on the existing marketing site, and
the mobile app opens them in a browser rather than carrying a second copy of the text.

## Phase Status

- [x] Phase 0 — research complete → [research.md](research.md)
- [x] Phase 1 — design complete → [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)
- [ ] Behavioural contract approved (Principle II gate — blocks `/speckit-tasks`)
- [ ] Phase 2 — task breakdown (`/speckit-tasks`)
