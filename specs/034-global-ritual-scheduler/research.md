# Phase 0 Research: Global Ritual Scheduler

**Feature**: `034-global-ritual-scheduler` | **Date**: 2026-08-22

All Technical Context unknowns are resolved below. No `NEEDS CLARIFICATION` markers remain.

---

## Finding 0: Why the per-definition timer is deletable rather than relocatable

This is the load-bearing finding; every decision below depends on it.

`RitualSchedulerWorkflow.Run` ([scheduler_workflow.go:50](../../backend/internal/collaboration/scheduler_workflow.go#L50))
calls:

```go
n, err := w.Logic.GenerateRitualInstances(ctx, w.AdminPool, input.OrgID, now)
```

`GenerateRitualInstances` ([scheduler_logic.go:19](../../backend/internal/collaboration/scheduler_logic.go#L19))
begins by listing **all** active definitions for the organization via
`ListActiveRitualDefinitionsForGeneration`, then for each one computes its dates with
`computeDatesInWindow(rule, lastGenerated, generationWindowDays, loc, now)`.

`input.DefinitionID` appears only in `slog` calls. It filters nothing.

Two consequences:

1. **Redundancy**: N definitions in an organization means N schedules, each firing a
   complete N-definition regeneration pass. (N−1) of every N passes are wasted.
2. **The cron translation is inert**: `RecurrenceRuleToSchedule`
   ([scheduler_workflow.go:78](../../backend/internal/collaboration/scheduler_workflow.go#L78))
   converts a recurrence rule into a cron expression that decides only *when the timer
   fires*. What gets generated is re-derived from the stored rule every run. A definition's
   dates are a pure function of `(recurrence_rule, timezone, last_generated_date,
   generation_window_days, now)` — never of when the timer fired.

Because generation is date-driven and idempotent rather than tick-driven, sweep cadence
cannot change output. That is what makes FR-005 (identical output) provable by construction.

---

## Decision 1: Wrap `GenerateRitualInstances`, do not rewrite it

**Decision**: Add a cross-organization loop above `GenerateRitualInstances` and leave that
function, `computeDatesInWindow`, and everything below them untouched.

**Rationale**: FR-005 demands byte-identical instance dates across every recurrence pattern
and timezone. The cheapest way to guarantee that is to not modify the code that produces
them. The loop is a handful of lines; a rewrite would put every recurrence pattern,
timezone edge case, round-robin waterline, and idempotency check back into review.

**Alternatives considered**:

- *Rewrite `GenerateRitualInstances` to be natively cross-org (one query over all
  organizations)*. Rejected: saves one query per organization per sweep, at the cost of
  re-verifying the entire generation path against FR-005 and of breaking the two
  `testWorld` helpers (`generateRitualInstances`, `generateRitualInstancesAt`) that a
  number of existing tests depend on. Wrong trade at this scale.
- *Keep per-definition schedules but make the workflow filter by `DefinitionID`*. Rejected:
  this "fixes" the redundancy while keeping every line of schedule-lifecycle glue, the cron
  translation, and the drift risk between a stored rule and a stored timer. It is the
  opposite of what the spec asks for.

---

## Decision 2: Discover organizations with `SELECT DISTINCT organization_id`

**Decision**: Add one query returning the organizations that hold at least one unarchived
ritual definition:

```sql
-- name: ListOrganizationIDsWithActiveRitualDefinitions :many
-- System-scope background query (global ritual sweep). Intentionally NOT filtered by
-- organization_id: its purpose is to discover which organizations to sweep. Returns only
-- organization IDs — no tenant row data. Runs on AdminPool. See Constitution Principle I,
-- "system operations with documented justification".
SELECT DISTINCT organization_id
FROM collaboration.ritual_definition
WHERE is_archived = FALSE
ORDER BY organization_id;
```

**Rationale**: Matches FR-004 exactly ("every organization that has at least one active,
unarchived ritual definition"). Sourcing from the ritual table rather than
`public.organization` means organizations with no rituals cost nothing, and deleted
organizations disappear automatically — their definitions are removed by the existing
`ON DELETE CASCADE` chain through `collaboration.project`. No separate liveness check is
needed, which resolves the "organization deleted or deactivated" edge case for free.

Precedent: `ListPendingRemindersGlobal` in `backend/database/scripts/calendar.query.sql`
already establishes the global-query-on-`AdminPool` pattern for background jobs.

**Alternatives considered**:

- *Enumerate `public.organization`*. Rejected: no such query exists today, it would sweep
  organizations that have never used rituals, and it would need its own status filter to
  skip suspended tenants.
- *One global query returning all definitions, grouped by organization in Go*. Rejected:
  would force Decision 1's rewrite, since `GenerateRitualInstances` re-queries definitions
  itself.

**Ceiling (recorded, accepted)**: Citus fans `SELECT DISTINCT` out to every shard. The
result set is tiny and the cost scales with total organization count, not ritual count.
Acceptable now; to be marked in code with a `ponytail:` comment naming the upgrade path
(narrow to organizations with definitions actually due, or cache between sweeps).

---

## Decision 3: Sweep cadence of 1 minute, bootstrapped at startup

**Decision**: One schedule, id `ritual_generation_sweep`, `flows.Every(1 * time.Minute)`,
written at server startup via `flows.ScheduleTx`.

**Rationale**: Matches FR-007 and the cadence already used by the platform's other global
polling jobs. Correctness does not depend on the value (Finding 0) — cadence sets only how
quickly a generation window is topped up after a change or an outage. One minute keeps
catch-up effectively immediate at negligible cost, since a sweep over organizations with
nothing due does no write work.

`flows.ScheduleTx` upserts on `schedule_id`
([client.go:240](file:///Users/nvcnvn/go/pkg/mod/github.com/nvcnvn/flows@v0.0.8/client.go)):
"If a schedule with the same scheduleID already exists it is updated." Running the bootstrap
on every instance at every restart therefore converges on exactly one row — satisfying FR-015
and SC-001 under the multi-instance deployment mandated by Principle XI. `flows` leases runs,
so only one instance executes any given cycle.

**Alternatives considered**:

- *Hourly*. Genuinely defensible once the short-interval recurrence types are gone
  (Decision 4): with `generation_window_days` defaulting to 30, hourly would be ample.
  Rejected because FR-007 fixes the cadence at one minute, the per-sweep cost of a no-op
  organization is negligible, and one minute bounds post-outage catch-up latency far more
  tightly. Revisit only if the org-discovery scan (Decision 2) becomes measurable.
- *A `flows.Register`-only registration, matching the calendar jobs*. Rejected — this is
  precisely the pre-existing defect described below. Registration does not schedule.
- *A migration that INSERTs the schedule row*. Rejected: puts a `flows`-internal row shape
  into a hand-written migration, and breaks silently if `flows` changes its table layout.
  Startup bootstrap uses the library's own supported API.

---

## Decision 4: Delete `every_minute` and `every_two_minutes`

**Decision**: Remove `RecurrenceTypeEveryMinute` and `RecurrenceTypeEveryTwoMinutes` from
`constants.go`, their `RecurrenceRuleToSchedule` cases (deleted with that function), and
their branch in `computeDatesInWindow` at
[scheduler_logic.go:374](../../backend/internal/collaboration/scheduler_logic.go#L374).

**Rationale**: Verified unreachable. `recurrenceTypeToString`
([ritual_logic.go:868](../../backend/internal/collaboration/ritual_logic.go#L868)) maps the
proto `RecurrenceType` enum to strings and can only ever emit `daily`, `weekly`, `monthly`,
or `custom_interval` — it defaults unknown values to `daily`. A grep across `*.proto`,
`*.ts`, `*.tsx`, and `*.go` finds these two strings in no file outside the three Go sites
being changed. No API path can create a definition carrying them.

Their `computeDatesInWindow` branch confirms the intent: it generates *one* instance dated
today, identical to what `daily` produces. They never meant "recur every minute" — they
existed solely to make the deleted per-definition cron fire quickly during testing. With the
cron gone they are dead weight, and FR-016 requires deleting code that exists only to
support per-definition scheduling.

**Alternatives considered**:

- *Keep them*. Rejected: unreachable constants with a live-looking generation branch are
  exactly the 3am-decode hazard, and the repository's standing position is that early
  development takes the clean removal over the compatibility shim.

**Note on FR-007's stated rationale**: the spec justified the one-minute cadence partly by
"the finest supported recurrence pattern". Once these two types are deleted, the finest
supported pattern is daily. The cadence value is unchanged and FR-007 still holds — the
justification now rests on parity with the platform's other global jobs and on catch-up
latency (Decision 3), not on a sub-daily recurrence pattern. Flagged so the requirement's
reasoning is not later mistaken for a live constraint.

---

## Decision 5: Preserve immediate-on-create generation directly

**Decision**: In `CreateRitualDefinition`, replace the
`flows.ScheduleTx(..., flows.WithRunNow())` call with a direct
`Logic.GenerateRitualInstances(ctx, tx, organizationID, time.Now())` inside the same tenant
transaction.

**Rationale**: FR-011 requires a newly created ritual to have its instances immediately, not
after up to a sweep interval. Today that comes from `WithRunNow()`, which the schedule
deletion removes. Calling generation directly is simpler than what it replaces: it drops the
enqueue-and-wait round trip, runs in the caller's transaction so the definition and its first
instances commit atomically, and follows the pattern `ChangeRitualDefinitionSchedule` already
uses at [ritual_logic.go:524](../../backend/internal/collaboration/ritual_logic.go#L524).

`ChangeRitualDefinitionSchedule` needs no change at all — its regeneration and its
removed/detached/created counts (FR-012) are already computed in logic, independent of any
schedule.

`UpdateRitualDefinition` needs no replacement: it currently only rewrites the cron and never
had `WithRunNow`, so it never regenerated eagerly. After the change the sweep picks up the
new rule within a minute — strictly better than the current behavior, which waited for the
rewritten cron's next fire.

**Alternatives considered**:

- *Let the sweep handle creation too*. Rejected: violates FR-011 and would be a visible
  regression — an owner creating a ritual would stare at an empty list.

---

## Decision 6: Remove orphaned schedule rows with a forward migration

**Decision**: Add `backend/k8s/base/database/migrations/20260822000002_drop_per_definition_ritual_schedules.up.sql`:

```sql
DELETE FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%';
```

**Rationale**: FR-013. Existing deployments hold one row per definition, all pointing at the
`ritual_scheduler` workflow. Left in place they would keep enqueueing runs for a workflow
name that no longer exists in the registry, producing a steady stream of failures. The
`ritual_def_` prefix comes from `RitualScheduleID`
([scheduler_workflow.go:72](../../backend/internal/collaboration/scheduler_workflow.go#L72))
and matches nothing else.

Forward-only per Principle I's migration workflow. Rollback, if ever needed, is a
compensating forward migration — but note the rows would be regenerated naturally by the old
code path, so a rollback needs no data restoration.

**Correctness is not contingent on this**: the sweep generates the same instances whether or
not stale rows exist, because generation is idempotent per definition and date. The migration
removes wasted work and error noise, not a correctness hazard.

---

## Decision 7: Update the two tests that assert per-definition schedules

**Decision**: Rewrite the `"when the flows schedule is created via RPC"` block in
[collaboration_schedule_generation_test.go:185-204](../../backend/integration/collaboration_schedule_generation_test.go#L185-L204).
Its assertion — `SELECT count(*) FROM flows.schedules WHERE schedule_id LIKE '%' || $1 ||
'%'` expecting exactly 1 per definition — inverts under this feature. It becomes an
assertion that the count is **0** for any definition, plus a platform-wide assertion that
exactly one ritual schedule row exists (SC-001).

**Rationale**: The test encodes the behavior being deleted. Inverting it turns the strongest
existing guard for the old design into the strongest guard for the new one.

The `testWorld` helpers `generateRitualInstances` and `generateRitualInstancesAt`
([helper_test.go:3421-3438](../../backend/integration/helper_test.go#L3421-L3438)) call
`GenerateRitualInstances` directly and are unaffected by Decision 1 — a deliberate benefit
of not rewriting that function. A new helper is added to drive the global sweep across
organizations.

---

## Pre-existing defect discovered (out of scope)

`CalendarReminderWorkflow` and `CalendarPresenceWorkflow` are registered
(`backend/cmd/server.go:473`, `:481`) but never scheduled. Their
`CalendarReminderScheduleID()`, `ReminderSchedule()`, `CalendarPresenceScheduleID()`, and
`PresenceSchedule()` helpers are called from nowhere in the repository — verified by grep.
No `flows.schedules` row is ever written for either, so neither job has run. Calendar event
reminders are not firing in production.

Not fixed here: different domain, different spec. Recorded because it is the reason FR-015
exists as an explicit requirement — copying the calendar pattern verbatim would reproduce
the bug in the ritual sweep. Recommend a follow-up spec.
