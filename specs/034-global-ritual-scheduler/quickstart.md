# Quickstart: Validating the Global Ritual Scheduler

**Feature**: `034-global-ritual-scheduler` | **Date**: 2026-08-22

How to prove the feature works end to end. Entity and query details are in
[data-model.md](./data-model.md); the job contract is in
[contracts/README.md](./contracts/README.md).

---

## Prerequisites

- PostgreSQL with Citus running and reachable via `DATABASE_URL`
- Backend built and runnable (`make check-backend` passes)
- The migration from [data-model.md](./data-model.md#migration) applied

```bash
cd backend
export DATABASE_URL="postgres://..."   # your local dev DSN
./scripts/migrate.sh                   # forward-only psql runner
./scripts/migrate.sh status            # confirm the new version is applied, not dirty
```

---

## 1. Structural checks (FR-003, FR-016)

These verify deletion. They need no database — if a deleted symbol were still referenced,
the build would fail.

```bash
cd backend
go build ./...
go vet ./...
```

Then confirm the machinery is actually gone rather than merely unused:

```bash
# Each of these must return NOTHING.
grep -rn "RitualScheduleID\|RecurrenceRuleToSchedule\|RitualSchedulerInput" --include="*.go" .
grep -rn "RecurrenceTypeEveryMinute\|RecurrenceTypeEveryTwoMinutes" --include="*.go" .
grep -rn "ritual_def_" --include="*.go" .
grep -rn "isoDayToCron\|parseTimeOfDay\|recurrenceRuleToJSON" --include="*.go" .
```

Expected: no output from any line. A hit means a symbol survived and FR-016 is unmet.

Confirm `recurrenceRuleToMap` **is** still present — only its `recurrenceRuleToJSON`
wrapper was removed:

```bash
grep -rn "func recurrenceRuleToMap" --include="*.go" .    # must return exactly one hit
```

---

## 2. Exactly one schedule row exists (FR-001, FR-015, SC-001)

Start the server, let it complete startup, then query the schedule registry.

```bash
cd backend && go run ./cmd    # or your usual run target
```

```sql
-- Expect exactly one row, and no per-definition rows.
SELECT schedule_id, workflow_name, cron_expr, enabled
FROM flows.schedules
WHERE workflow_name = 'ritual_generation_sweep'
   OR schedule_id LIKE 'ritual_def_%';
```

Expected: one row, `schedule_id = 'ritual_generation_sweep'`, a 1-minute interval
expression, `enabled = true`. Zero rows with a `ritual_def_` prefix, however many ritual
definitions exist.

**Restart idempotency (FR-015)**: stop and restart the server, then re-run the query. The
count must still be 1 — `flows.ScheduleTx` upserts by schedule ID. Start a second instance
against the same database and re-run it again; still 1.

---

## 3. The sweep actually runs and reports (FR-014, US3)

Watch the log for a minute after startup:

```bash
# Expect roughly one line per minute.
go run ./cmd 2>&1 | grep "ritual generation sweep"
```

Expected shape — all three counters from
[contracts/README.md](./contracts/README.md#output) must be present:

```
level=INFO msg="ritual generation sweep complete" organizations_processed=3 definitions_processed=12 total_generated=7
```

An operator diagnosing "why didn't my ritual generate?" reads this one line. If
`organizations_processed` is 0 while active definitions exist, the org-discovery query is
the suspect; if it is non-zero but `total_generated` is 0, generation windows are already
full — which is the normal steady state, not a fault.

---

## 4. Behavioral validation (all user stories)

The behavioral contract lives in
`backend/integration/collaboration_schedule_generation_test.go`. Scenario names are listed
in [plan.md](./plan.md#behavioral-contract-principle-ii--requires-approval-before-speckit-tasks).

Run the feature's scenarios first:

```bash
make test-backend-one T=TestGlobalRitualScheduler
```

`go test -v` output reads as the behavior specification — verify the scenario names match
the approved contract before trusting a pass.

Then run the **entire** suite, which is what the Definition of Done requires:

```bash
make test-backend        # go test ./integration/... — zero failures, not just the new test
```

Pay particular attention to the pre-existing ritual suites, which are the real regression
guard for FR-005:

```bash
make test-backend-one T='TestRitual|TestCollaborationRitual|TestScheduleGeneration'
```

---

## 5. Equivalence spot-check (FR-005, SC-003)

The automated version of this is in the scenario contract. To verify by hand that a given
recurrence pattern produces the same dates it did before:

1. On `main`, create a ritual definition for the pattern under test, let generation run, and
   record the resulting instance dates:

   ```sql
   SELECT scheduled_date
   FROM collaboration.task
   WHERE organization_id = :org AND ritual_definition_id = :def
   ORDER BY scheduled_date;
   ```

2. On `034-global-ritual-scheduler`, create the identical definition (same rule, timezone,
   and `generation_window_days`) and run the same query.

3. Diff the two date lists. Expected: identical.

Cover the full matrix — daily, every-N-days, weekly with selected weekdays, monthly with a
day-of-month, custom interval — and repeat at least one of them with a non-UTC timezone
(e.g. `Asia/Tokyo`) and one with a `UTC+N` offset string, since both forms flow through
`loadTimezone`.

This should hold by construction: `GenerateRitualInstances` and `computeDatesInWindow` are
unmodified (see [research.md, Decision 1](./research.md#decision-1-wrap-generateritualinstances-do-not-rewrite-it)).
A difference here means something below the sweep was changed and should not have been.

---

## 6. Lifecycle writes no schedule rows (FR-002, US2)

Through the UI or an RPC client, run a definition through its full lifecycle — create,
update the recurrence, archive, unarchive, change the schedule — then:

```sql
SELECT count(*) FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%';
```

Expected: `0` after every step.

Two behaviors to confirm alongside it:

- **Create (FR-011)**: the new ritual's instances are visible immediately, without waiting
  up to a minute for a sweep.
- **Change schedule (FR-012)**: the response still carries non-zero
  `instances_removed` / `instances_detached` / `instances_created` where the change warrants
  them.

---

## 7. Redundancy is gone (SC-002)

Create ~20 active ritual definitions in one organization, then observe a single sweep cycle.

Expected: one `GenerateRitualInstances starting` log line for that organization per cycle.
Before this change there would have been 20 — one per definition schedule, each doing the
same whole-organization pass.

```bash
go run ./cmd 2>&1 | grep "GenerateRitualInstances starting" | grep :org-id
```

---

## Rollback

Forward-only, per Constitution Principle I. The migration only deletes stale
`flows.schedules` rows; it restores nothing on revert and needs to restore nothing —
reverting the code would recreate per-definition rows through the old CRUD path on the next
definition write. If a revert is ever needed, also delete the global row so the two designs
do not both run:

```sql
DELETE FROM flows.schedules WHERE schedule_id = 'ritual_generation_sweep';
```
