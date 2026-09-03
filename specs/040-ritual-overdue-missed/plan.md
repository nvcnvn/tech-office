# Implementation Plan: Overdue and Missed Rituals Become Real States with Alerts

**Branch**: `040-ritual-overdue-missed` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/040-ritual-overdue-missed/spec.md`

## Summary

A ritual instance whose completion deadline passes without complete evidence must be
*written* to the `overdue` state and, one completion window later, to the terminal `missed`
state, notifying the assignee, the reviewer and — for `missed` with no reviewer — the
project's owners and admins. Today nothing writes either state, so an owner only learns a
checklist was skipped by opening a health report. This is drift D29.

**Technical approach**: extend the *existing* state-derivation function rather than adding a
parallel one, then add a second recurring flows job that calls the *existing* reconcile
function per late instance.

1. `determineRitualTaskStateCategory` gains a `missed` outcome and reorders `overdue` above
   `in_progress` (FR-006). Because both paths call it, FR-007 is satisfied by construction.
2. `reconcileRitualTaskStateForTask` — already the single writer of ritual state — publishes
   the overdue/missed notification when, and only when, it performs that transition (FR-020).
3. A new `ritual_reconciliation_sweep` flows job (5-minute cadence) discovers organizations
   holding late instances, lists a bounded page of them per organization, and calls that same
   reconcile function per instance.
4. The two notification types deleted on 2026-08-30 are restored to the Go constant list and
   the database CHECK in one change set (FR-019), which
   `TestNotificationTypeCheckMatchesGoConstants` enforces.
5. Client-side lateness computation in `classifyRitualTaskBucket` is replaced by a read of the
   stored state category (FR-022), and both clients resolve the two new notification types to
   the ritual instance (FR-017).

No new RPC, no new column, no new configuration knob.

## Technical Context

**Language/Version**: Go 1.24 (backend); TypeScript 5.x on Next.js 15 / React 19 (web) and
Expo SDK 54 / React Native (mobile)

**Primary Dependencies**: `connectrpc.com/connect`, `github.com/nvcnvn/flows` (durable
scheduled workflows), `sqlc` (typed queries), `pgx/v5`; MUI v7 on web, Expo Router on mobile

**Storage**: PostgreSQL, multi-tenant by `organization_id`. Forward-only migrations in
`backend/database/migrations/`; `backend/database/scripts/schema.sql` is a generated snapshot
regenerated with `backend/scripts/regen-schema.sh` and never hand-edited.

**Testing**: Go integration tests against a real database using the `testWorld` helper
(`backend/integration/`), Go unit tests for pure functions, Playwright for web E2E, Maestro
for mobile.

**Target Platform**: Linux server (Docker Swarm), modern browsers, iOS 15+ / Android 8+

**Project Type**: Web service + web app + mobile app in one monorepo, released together.

**Performance Goals**: One reconciliation pass every 5 minutes across all organizations.
Discovery is one cross-organization aggregate query; per-organization work is bounded at 500
instances per pass. SC-002 (assignee notified within 10 minutes of the deadline) holds with
a 5-minute cadence plus run time.

**Constraints**: The pass runs on `AdminPool` (cross-tenant) and must therefore read only
what it needs; one organization's failure must not abort the pass; the pass must be
idempotent; notifications must be ordinary priority and subject to do-not-disturb.

**Scale/Scope**: Backend — 2 new queries, 1 new workflow file, 1 new logic method, 2 new
notification publishers, 1 migration, edits to 3 existing files. Clients — 5 files on web,
2 on mobile, 3 in shared packages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I — Multi-tenant isolation | Tenant queries filter on `organization_id`; `AdminPool` only for documented system operations | **PASS.** `ListOrganizationIDsWithReconcilableRitualInstances` is the only unfiltered query and exists solely to discover which organizations to sweep — the same justification, in the same file, as the generation sweep's sibling query. Every other query is `organization_id`-scoped. |
| II — Contract-first (proto) | Contract changes land in `rpc/v1/*.proto` first | **PASS (vacuous).** No RPC is added, removed or changed. The contract surface touched is the notification-type enumeration, whose contract is the Go constant list asserted against the DB CHECK. |
| III — Domain boundaries | No cross-domain database access | **PASS.** `internal/collaboration` publishes through the `NotificationPublisher` interface it already holds; it does not touch notification tables. |
| IV — Test-first / integration coverage | New behaviour covered by integration tests against a real database | **PASS.** New suite `collaboration_ritual_reconciliation_test.go` plus unit tests for the pure derivation function. See [quickstart.md](./quickstart.md). |
| V — Observability | Structured logging, meaningful job output | **PASS.** FR-012 output counts, per-organization and per-instance error logs, and a log line for the "project has no overdue/missed state" condition. |
| VI — Versioning / breaking changes | Coordinated across backend, web and mobile | **PASS.** `ritual_instance_assigned` is removed from the TypeScript union in the same change set that restores the two live types. All three clients ship together. |
| XII — Engineering docs | `backend/docs/` architecture references updated when architecture moves | **PASS.** A second recurring platform job is an architecture change; `backend/docs/SYSTEM-ARCHITECTURE.md` and `NOTIFICATION-SYSTEM-ARCHITECTURE.md` are updated. |
| XIII — Mobile feature scope | Mobile carries worker-facing capability, not administration | **PASS.** Mobile gains display of two states and navigation for two notification types. Nothing administrative. |
| Domain snapshot rule | `docs/domain/` updated in the same change set | **PASS.** `docs/domain/rituals-tasks.md` gains the reconciliation sweep and loses its "Known drift" section; `docs/domain/README.md` moves D29 to the fixed list (SC-007). |

No violations. **Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/040-ritual-overdue-missed/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── reconciliation-sweep.md
│   └── notifications.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── cmd/
│   └── server.go                                    # register + ScheduleTx the new sweep
├── database/
│   ├── migrations/
│   │   └── 20260903000001_ritual_overdue_missed_notification_types.up.sql   # NEW
│   └── scripts/
│       ├── collaboration.query.sql                  # 2 new queries; 2 urgency-bucket edits
│       └── schema.sql                               # regenerated, never hand-edited
└── internal/
    ├── collaboration/
    │   ├── ritual_task_state.go                     # missed outcome, reordering, notify-on-transition
    │   ├── ritual_notification_logic.go             # notifyRitualInstanceOverdue / …Missed
    │   ├── ritual_reconciliation_workflow.go        # NEW — the sweep
    │   ├── ritual_reconciliation_logic.go           # NEW — per-organization pass
    │   ├── logic.go                                 # Logic interface gains one method
    │   └── constants.go                             # notification-type aliases
    └── notification/
        └── constants.go                             # restore the two types in 3 places

backend/integration/
├── collaboration_ritual_reconciliation_test.go      # NEW
├── helper_test.go                                   # runRitualReconciliationSweep helper
└── notification_type_alignment_test.go              # passes unchanged; guards FR-019

frontend/
├── packages/
│   ├── apis/src/notification.ts                     # union: drop ritual_instance_assigned
│   ├── apis/src/collaboration-ritual.ts             # bucket from stored state category
│   └── notifications/src/utils.ts                   # icon/label rows
└── apps/
    ├── web/src/app/workspace/
    │   ├── notifications/utils/notificationNavigation.ts   # focus intent for both types
    │   └── projects/[id]/components/TodayView.tsx          # states from context; missed bucket
    └── mobile/src/lib/linking.ts                    # focus intent for both types

docs/domain/
├── rituals-tasks.md                                 # sweep documented; Known drift removed
└── README.md                                        # D29 → fixed
```

**Structure Decision**: The existing monorepo layout is used unchanged. The feature is a
backend behaviour change with a thin client follow-through, so the two new backend files sit
beside their siblings in `internal/collaboration` (`ritual_reconciliation_workflow.go` mirrors
`scheduler_workflow.go`; `ritual_reconciliation_logic.go` mirrors `scheduler_logic.go`) and no
new package, module or directory is introduced.

## Design decisions carried into implementation

These are resolved in [research.md](./research.md); the summary is here so the plan stands
alone.

1. **One derivation function, two callers.** `determineRitualTaskStateCategory` becomes the
   sole authority on ritual state for both the evidence path and the sweep. The new
   precedence is: `verified` → `submitted` → `missed` → `overdue` → `in_progress` →
   `scheduled` → `todo`.
2. **The grace period is the definition's `completion_window_hours`.** An instance becomes
   `missed` at `completion_deadline + completion_window_hours`. No new column.
3. **The sweep reuses `reconcileRitualTaskStateForTask` per instance** rather than writing a
   bulk `UPDATE … WHERE`. A set-based update would need to re-implement the evidence rules in
   SQL, which is exactly the divergence FR-007 forbids.
4. **Notification emission lives inside the reconcile function**, so a transition performed by
   an evidence write and one performed by the sweep notify identically.
5. **The backfill horizon is 7 days**, checked against `completion_deadline`. Older instances
   transition silently (FR-021).
6. **Per-organization bound is 500 instances per pass**, ordered by `completion_deadline ASC`
   so the oldest backlog drains first and a large backlog produces more passes rather than one
   failed pass (FR-013).
7. **Clients read the stored category.** `classifyRitualTaskBucket` takes the project's
   states and returns `overdue`/`missed` from `state.category`, removing the last client-side
   lateness computation (FR-022, SC-005).

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.

## Post-design Constitution re-check

Re-evaluated after Phase 1. No gate moved. The two design choices that could have introduced a
violation were both resolved away from one: the cross-organization discovery query returns
organization IDs only and is documented in place (Principle I), and the client fix reads the
project states both clients already fetch rather than widening the `Task` contract
(Principle II). **PASS — Complexity Tracking remains empty.**
