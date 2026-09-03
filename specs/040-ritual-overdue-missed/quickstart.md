# Quickstart: Validating Overdue and Missed Rituals

Runnable scenarios that prove the feature works end to end. Entity shapes are in
[data-model.md](./data-model.md); interfaces are in [contracts/](./contracts/). This document
is a validation guide — no implementation bodies here.

---

## Prerequisites

```bash
make infra-up          # Postgres and friends
make check-postgres    # confirm the database is reachable
```

Apply the new migration and regenerate the derived artifacts (in this order — the migration is
the source of truth, `schema.sql` is generated and must never be hand-edited):

```bash
# migrations run on server start; to apply them without the server:
cd backend && go run ./cmd migrate up

./backend/scripts/regen-schema.sh   # regenerates database/scripts/schema.sql
cd backend && sqlc generate         # regenerates typed queries after collaboration.query.sql
```

---

## The critical guard, first

`TestNotificationTypeCheckMatchesGoConstants` is what makes FR-019 real: it fails if the two
new types are added to the Go constant list but not the database CHECK, or the reverse. Run it
before anything else.

```bash
make test-backend-one T=TestNotificationTypeCheckMatchesGoConstants
```

**Expected**: PASS, with `ritual_instance_overdue` and `ritual_instance_missed` present on
both sides and `ritual_instance_assigned` present on neither.

---

## Backend integration scenarios

New suite: `backend/integration/collaboration_ritual_reconciliation_test.go`, built on the
`testWorld` helper. A `runRitualReconciliationSweep(now)` helper is added to `helper_test.go`,
mirroring the existing `runRitualGenerationSweep()`.

**Time is injected, never slept for.** `Sweep(ctx, now)` takes the clock as a parameter, so
"the deadline passed three days ago" is expressed by passing `time.Now().AddDate(0,0,3)`.

```bash
make test-backend-one T=TestRitualReconciliation
```

### Scenario 1 — a skipped checklist becomes overdue and the assignee is told (US1, FR-001, FR-014)

**Arrange**: a ritual definition with one required evidence requirement and
`completion_window_hours = 24`; one generated instance assigned to a worker; no evidence
submitted.

**Act**: `runRitualReconciliationSweep(deadline + 1h)`.

**Assert**: the instance's state category is `overdue`; the assignee holds exactly one
`ritual_instance_overdue` notification naming the ritual; the sweep output reports
`MarkedOverdue == 1`.

### Scenario 2 — repeated passes change nothing (US1 scenario 2, FR-010, SC-004)

**Act**: run the sweep three more times at the same injected `now`.

**Assert**: state still `overdue`; still exactly one `ritual_instance_overdue` notification
for that instance; each later output reports `MarkedOverdue == 0`.

### Scenario 3 — evidence rescues the instance (US1 scenario 3)

**Arrange**: the overdue instance from Scenario 1.

**Act**: the assignee submits all required evidence; then run the sweep again.

**Assert**: the state left `overdue` on the existing evidence-driven path (`submitted` or
`verified` depending on approval mode) and the later sweep does not touch it —
`InstancesExamined` no longer counts it, because `submitted` is not a candidate category.

### Scenario 4 — a future deadline is untouched (US1 scenario 4, FR-005)

**Assert**: an instance whose deadline has not passed, and an instance with
`completion_deadline IS NULL`, are both left in their current state with no notification and
are not counted in `InstancesExamined`.

### Scenario 5 — partial evidence is still overdue (US1 scenario 5, FR-006)

**Arrange**: a definition with two required requirements; one submitted.

**Act**: sweep past the deadline.

**Assert**: state is `overdue`, **not** `in_progress`. This is the precedence reordering; it
is also covered by the unit test below.

### Scenario 6 — escalation to missed (US2 scenario 1, FR-002, FR-015)

**Act**: sweep at `deadline + completion_window_hours + 1h`.

**Assert**: state category is `missed`; the assignee and the reviewer each hold exactly one
`ritual_instance_missed` notification; `MarkedMissed == 1`.

### Scenario 7 — missed with no reviewer escalates to owners and admins (US2 scenario 2, FR-016, SC-003)

**Arrange**: an instance with an assignee and **no** reviewer or approver; the project has one
`owner` and one `admin`.

**Assert**: both the owner and the admin hold a `ritual_instance_missed` notification.

### Scenario 8 — missed is terminal (US2 scenario 3, FR-003)

**Act**: run further passes after Scenario 6.

**Assert**: state stays `missed`; no additional notification of any type; the instance is no
longer returned as a candidate.

### Scenario 9 — straight to missed in one step (US2 scenario 4)

**Arrange**: an instance whose deadline and grace period both elapsed before any pass ran.

**Act**: one sweep.

**Assert**: state is `missed` — it does not pause at `overdue` and require a second pass.

### Scenario 10 — accounted-for outcomes are left alone (US2 scenario 5, FR-004)

**Assert**: a `skipped` instance (via `SkipRitualInstance`), a `verified` instance and an
instance with `detached_from_ritual = true` are all untouched and uncounted after a sweep past
their deadlines.

### Scenario 11 — the reviewer's delay is not the worker's fault (edge case)

**Arrange**: all required evidence submitted and pending review; deadline passed.

**Assert**: state stays `submitted`; no notification.

### Scenario 12 — a rejected submission does not shelter the instance (edge case)

**Arrange**: required evidence submitted and then rejected; deadline passed.

**Assert**: state is `overdue`.

### Scenario 13 — archived definitions are still reconciled (FR-009)

**Arrange**: an instance is generated, then its definition is archived.

**Act**: sweep past the deadline.

**Assert**: the instance still becomes `overdue`. This is the case that would fail if
discovery reused `ListOrganizationIDsWithActiveRitualDefinitions`.

### Scenario 14 — one organization's failure does not abort the pass (FR-011, SC-006)

**Arrange**: two organizations, each with one late instance. Break one — the cheapest fault is
a project whose ritual states have been deleted so no `overdue` state row exists.

**Assert**: the sweep returns without error; `OrganizationsProcessed == 2`; the healthy
organization's instance is `overdue`; the broken organization's instance is unchanged and its
condition is logged.

### Scenario 15 — the backfill horizon suppresses historical alerts (FR-021)

**Arrange**: an instance whose deadline passed 30 days ago.

**Assert**: it transitions to `missed`; **zero** notifications are produced.

### Scenario 16 — the pass is bounded (FR-013)

**Arrange**: more late instances in one organization than
`ritualReconciliationInstanceLimit`.

**Assert**: one pass examines exactly the limit, oldest deadline first; a second pass picks up
the remainder; nothing is skipped or double-counted across the two.

---

## Backend unit tests

`backend/internal/collaboration/ritual_task_state_test.go` — table test over
`determineRitualTaskStateCategory`, one row per line of the precedence table in
[data-model.md](./data-model.md). Pure function, no database:

```bash
cd backend && go test ./internal/collaboration/ -run TestDetermineRitualTaskStateCategory -v
```

**The rows that matter most**, because they are the ones that changed:

| Evidence state | Deadline | Grace | Expected |
|---|---|---|---|
| 1 of 2 required submitted | passed | not elapsed | `overdue` (was `in_progress`) |
| 2 of 2 required submitted, none rejected | passed | elapsed | `submitted` (outranks both) |
| 1 of 2 submitted then rejected | passed | not elapsed | `overdue` |
| nothing submitted | passed | elapsed | `missed` |
| nothing submitted | passed | definition unloadable | `overdue`, never `missed` |
| nothing submitted | not passed | — | `todo` or `scheduled` |

---

## Frontend E2E

`frontend/apps/web/e2e/` — extend the existing ritual spec rather than adding a suite.

```bash
make test-frontend-one F=ritual
```

**Assert** (US3, FR-022, FR-023, SC-005):

1. With one `overdue` and one `missed` instance seeded, the project Today view shows them in
   the **Overdue** and **Missed** sections, the list view shows the same state names, and the
   Health tab counts them under overdue and missed.
2. The counts on the Health tab and the state shown on the task detail page agree — no screen
   disagrees with another.
3. Clicking a `ritual_instance_overdue` notification in the popup navigates to that task with
   `focusIntent=submit_requirement`; a `ritual_instance_missed` notification navigates with
   `focusIntent=view_instance`.

---

## Mobile

```bash
make test-mobile-one F=<flow>
```

**Assert**: the ritual instance card renders `Overdue` and `Missed` with the danger tone —
`getStateTone` already maps both categories, so this is a regression check rather than new
behaviour — and a tapped overdue/missed push lands on the instance rather than a generic list.

Per the repository's standing rule, verify on **Android as well as iOS**; the narrow-Android
layout is where a new section header regresses unnoticed.

---

## Manual end-to-end check

1. `make infra-up && make dev` (or the backend and web dev servers individually).
2. Create a ritual with `completion_window_hours = 1` and a recurrence that produces an
   instance today.
3. Wait for the deadline to pass, then at most 5 minutes more for the sweep.
4. **Expect**: the assignee's notification bell shows *Ritual overdue*; the instance shows
   `Overdue` on the board, in Today, and on the task detail page; the server log contains
   `ritual reconciliation sweep complete` with non-zero `marked_overdue`.
5. Wait one more hour plus one sweep. **Expect**: *Ritual missed*, state `Missed`, and the
   instance gone from the assigned-work summary because `Missed` is a closed state.

---

## Definition of done

- [ ] All sixteen integration scenarios pass
- [ ] `TestNotificationTypeCheckMatchesGoConstants` passes
- [ ] `make lint-tenancy` passes — the two new queries respect Principle I, and the
      cross-organization one carries its documented justification
- [ ] `make test-backend` passes with no regression in the existing ritual suites, in
      particular `collaboration_ritual_notification_test.go` and
      `collaboration_schedule_generation_test.go`
- [ ] `schema.sql` regenerated by script, not by hand
- [ ] `docs/domain/rituals-tasks.md` documents the reconciliation sweep and no longer carries
      the "Known drift" section; `docs/domain/README.md` moves D29 to the fixed list (SC-007)
- [ ] `backend/docs/SYSTEM-ARCHITECTURE.md` and `NOTIFICATION-SYSTEM-ARCHITECTURE.md` name the
      second recurring job and the two notification types
