# Quickstart: validating "Ritual assignment follows the shift"

How to run this feature end to end locally and prove each Success Criterion. This is a
validation and run guide, not an implementation guide — the schema is in
[data-model.md](./data-model.md), the surfaces are in
[contracts/proto-and-sql.md](./contracts/proto-and-sql.md), and the code lands via
`tasks.md`.

Use the repository's supported tooling (Makefile targets, `backend/docker-compose.yml`,
`scripts/`) rather than improvising local workarounds.

---

## 1. Prerequisites

```bash
make infra-up                       # PostgreSQL and friends
export DATABASE_URL="postgres://postgres:tech_office_password@localhost:5432/tech_office_db?sslmode=disable"
cd backend && ./scripts/migrate.sh  # applies the new .up.sql forward migration
./scripts/regen-schema.sh           # regenerates database/scripts/schema.sql — never hand-edit it
```

After the migration and regeneration, the tenancy linter must be green before anything else
is worth running:

```bash
make lint-tenancy
```

It parses `schema.sql` and every `*.query.sql` with the real PostgreSQL parser. A missing
`organization_id` in a new join or an unmarked cross-tenant query is a build failure here,
not a review comment.

Then regenerate the typed layers:

```bash
cd backend && sqlc generate      # database/*.query.sql.go
# proto regeneration via the repository's existing buf/protoc target
cd frontend && pnpm install && pnpm build --filter apis
```

---

## 2. Fixture: one store, two people, one rota

The shape every scenario below builds on.

1. Create an organization and a project.
2. Create a department, "Store floor", with two active employees — Ana and Ben.
3. Create a ritual definition, "Closing count", recurring **daily**, timezone
   `Asia/Tokyo`, generation window 30 days.
4. Add a department pool on that definition for "Store floor" with strategy
   **on-shift**.
5. On the calendar, create `event_type = 'shift'` events with Ana and Ben as **attendees**:
   Ana Mon/Wed/Fri, Ben Tue/Thu, for next week only.

The two halves that matter: the pool's strategy is what selects the new behaviour, and the
attendees of the shift events are the rota. Nothing else in the product records who is
working.

---

## 3. Drive the cycles without waiting for timers

All three sweeps expose `Sweep(ctx, now)` so a cycle can be driven with an injected clock
instead of sleeping. In a live server they run on their own cadences: generation every 1
minute, shift resolution every 2 minutes, reconciliation every 5 minutes.

```go
gen  := &collaboration.RitualGenerationWorkflow{Logic: logic, Queries: q, AdminPool: pool}
res  := &collaboration.RitualShiftResolutionWorkflow{Logic: logic, Queries: q, AdminPool: pool}

_, _ = gen.Sweep(ctx, now)   // materialise the 30-day window
_, _ = res.Sweep(ctx, now)   // bind, rebind, escalate
```

The shift coverage reader must be injected before the resolution sweep runs, or every slot
will (correctly, per FR-016) stay awaiting resolution:

```go
logic.SetShiftCoverageReader(calendar.NewLogic(q, nil, nil, nil))
```

---

## 4. Proving each Success Criterion

### SC-001 — assigned instances always go to someone rostered

Generate the window, then for next week's instances read the assignee and check the
calendar:

```sql
SELECT t.scheduled_date, ta.employee_id, a.resolution_state
FROM collaboration.task t
JOIN collaboration.ritual_instance_pool_assignment a
  ON (a.organization_id, a.task_id) = (t.organization_id, t.id)
LEFT JOIN collaboration.task_assignee ta
  ON (ta.organization_id, ta.task_id) = (t.organization_id, t.id) AND ta.role = 'assignee'
WHERE t.organization_id = :org AND t.task_kind = 'ritual_instance'
ORDER BY t.scheduled_date;
```

**Expected**: Monday, Wednesday, Friday → Ana. Tuesday, Thursday → Ben.
`resolution_state = 'resolved'` for all five. Nobody is ever assigned a date they are off.

### SC-002 — publishing a rota assigns existing instances within one cycle

The fixture publishes only next week, so the remaining ~23 days of the 30-day window are
`awaiting_shift` with no assignee.

```sql
SELECT resolution_state, COUNT(*)
FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = :org GROUP BY 1;
```

**Expected before**: 5 `resolved`, ~23 `awaiting_shift`, 0 assignees on the waiting ones,
and **no** round-robin fallback assignment anywhere.

Now add shifts for the week after, run `res.Sweep(ctx, now)` **once**, and re-run the query.

**Expected after**: exactly the newly covered dates flipped to `resolved`, their assignees
notified with a `task_assigned` notification, and no manual step involved.

### SC-003 — a shift swap moves the checklist

Take next Tuesday. Remove Ben from that shift's attendees and add Ana. Run
`res.Sweep(ctx, now)` once.

**Expected**: the Tuesday instance's assignee changes from Ben to Ana, Ben is notified it is
no longer his, Ana is notified it is now hers, and `assigned_employee_id` on the pool row
follows.

Then remove Ana too, leaving nobody covering Tuesday, and sweep again.
**Expected**: the assignment is withdrawn, the row returns to `awaiting_shift`, Ana is
notified.

### SC-004 — an unassignable checklist reaches an owner on its date

Leave one date with no rota and advance the injected clock past the start of that date in
the definition's timezone (`resolve_by`). Run `res.Sweep(ctx, laterNow)`.

**Expected**: that row moves to `closed_unresolved` with `closed_reason = 'no_roster'`,
`escalated_at` set, and exactly one `ritual_instance_unassigned` notification delivered to
the project's owners and admins. Run the sweep a second time — **expected**: no second
notification, because the transition is a compare-and-set and the row is already closed.

Repeat with a scheduled date more than 7 days in the past. **Expected**: the state change
still happens, no notification is published, and the suppression is logged — matching the
existing overdue/missed backfill horizon so a first deployment does not alert an owner about
every historical instance at once.

### SC-005 — switching an existing ritual from round-robin to on-shift

On a definition whose pool is `round_robin` and whose future instances are already
generated, change the strategy to `on_shift` in the web editor and save. Run
`res.Sweep(ctx, now)` once.

**Expected**: future untouched instances are adopted and re-resolved to the rostered people;
past instances and instances with submitted evidence keep their existing assignee; the
definition is neither deleted nor recreated.

Switch it back to `round_robin` and sweep again. **Expected**: waiting slots are assigned
under round-robin and their pool-assignment rows are removed.

### SC-006 — generation still finishes inside its interval

Not asserted by a test (see [contracts/test-scenarios.md](./contracts/test-scenarios.md) for
why). Measure it instead:

```bash
# Seed 200 active definitions with on-shift pools and a 30-day window, then:
#   time one gen.Sweep(ctx, now) against that database.
```

**Expected**: well under 60 seconds. Note that the 30-reads-per-definition cost is paid once
— at creation, inside the creation transaction — and a steady-state sweep generates one new
date per definition per day. The sweep's structured log line
(`ritual generation sweep complete`) carries the counters that make a regression visible in
production without a synthetic benchmark.

**Measured 2026-09-04**, on the local compose PostgreSQL with 200 on-shift definitions in
one organization, by seeding them and timing one cycle from a throwaway integration test
(written, run, and deleted — a wall-clock assertion left in CI is the first test somebody
disables):

| Cycle | Work | Elapsed | Budget |
|---|---|---|---|
| `GenerateRitualInstances` | 5,209 instances — the whole 30-day window for all 200 definitions at once, the worst case | **22.4 s** | 60 s |
| `ResolveRitualShiftAssignments` | 500 slots (the per-pass bound) | **0.46 s** | 120 s |

The generation figure is the cold-start case; steady state is one new date per definition
per day, so roughly 200 instances rather than 5,209. Resolution is bounded at
`ritualShiftResolutionSlotLimit` per organization per pass by construction, so its cost does
not grow with the backlog — a larger backlog produces more passes, not one slower pass.

### SC-007 — nothing is lost

```sql
-- Every ritual instance with an on-shift pool has exactly one slot row per pool,
-- and every closed-by-no-roster row has an escalation timestamp.
SELECT resolution_state, closed_reason, COUNT(*) FILTER (WHERE escalated_at IS NULL)
FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = :org
GROUP BY 1, 2;
```

**Expected**: no row is `closed_unresolved` with `closed_reason = 'no_roster'` and a NULL
`escalated_at`. Every slot either becomes `resolved` or produces exactly one owner alert.

---

## 5. Web surface (User Story 4)

```bash
make check-servers        # backend + web running
```

1. Open `/workspace/projects/<id>/rituals/<definitionId>`.
2. Add a department pool. **Expected**: the strategy select offers **Round-robin**,
   **Least-assigned** and **On-shift**.
3. Choose On-shift, save, reload. **Expected**: it persisted, and the pool row states that
   assignment depends on shift events on the calendar for that department (FR-018).
4. Open an instance whose slot is awaiting resolution. **Expected**: instead of a blank
   assignee, it reads that nobody in the department is rostered for that date (FR-019).

---

## 6. Mobile surface

```bash
cd frontend && pnpm --filter mobile start      # LAN-IP-driven; same command for both platforms
# or pnpm --filter mobile ios / pnpm --filter mobile android for a native run
```

Open a ritual instance awaiting resolution on the task detail screen. **Expected**: the same
waiting-for-the-rota explanation as web. Verify on **both** Android and iOS — a
narrow-Android layout regression does not show on an iPhone SE. Strategy configuration is
intentionally absent on mobile.

---

## 7. Automated suites

```bash
make lint-tenancy
make test-backend-one T=TestCalendarShiftCoverage
make test-backend-one T=TestRitualOnShiftAssignment
make test-backend                                    # full backend integration suite
make test-frontend-one F=ritual-shift-assignment
make test-frontend                                   # full Playwright suite
```

The feature is DONE only when the whole backend integration suite **and** the whole E2E
suite pass (Constitution II), and when `docs/domain/rituals-tasks.md`,
`docs/domain/calendar.md` and `backend/docs/SYSTEM-ARCHITECTURE.md` describe the shipped
behaviour (Constitution XII).
