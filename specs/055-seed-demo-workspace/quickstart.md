# Quickstart: validating the demo workspace

**Branch**: `055-seed-demo-workspace` | **Spec**: [spec.md](spec.md)

Proves the two things a store reviewer would otherwise discover first: the deletion can be
completed, and the phone is not empty. Details of what is written live in
[data-model.md](data-model.md); the command surface is in
[contracts/seed-demo-org-cli.md](contracts/seed-demo-org-cli.md).

## Prerequisites

```bash
make dev-up          # Postgres, Redis, MinIO — backend/docker-compose.yml
make migrate         # forward-only migrations
```

A running backend is needed for steps 3 and 4 (`make dev-backend`), because the ritual
sweeps are server-scheduled and the mobile app needs something to talk to.

---

## 1. Seed, and read what it printed

```bash
cd backend && go run ./cmd seed-demo-org --subdomain demo
```

**Expected**: exits `0`. Three credential blocks in order — `PRIMARY credential`,
`SPARE credential — this is the one to delete.`, `SECOND credential`. Exactly one block
contains `the one to delete`.

## 2. Seed again and confirm nothing doubled

```bash
go run ./cmd seed-demo-org --subdomain demo
```

**Expected**: prints `Reusing existing demo workspace`, and the counts in the idempotency
table of [contracts/seed-demo-org-cli.md](contracts/seed-demo-org-cli.md) are unchanged —
1 organization, 3 active employees, 2 owners, 6 messages, 2 projects, 6 standard tasks,
2 ritual instances, 1 ritual definition.

```bash
psql "$DATABASE_URL" -f - <<'SQL'
SELECT
  (SELECT count(*) FROM organization.employee e JOIN public.organization o ON o.id=e.organization_id
    WHERE o.subdomain='demo' AND e.is_active) AS active_people,
  (SELECT count(*) FROM collaboration.task t JOIN public.organization o ON o.id=t.organization_id
    WHERE o.subdomain='demo' AND t.task_kind='standard' AND NOT t.is_deleted) AS work_items,
  (SELECT count(*) FROM collaboration.task t JOIN public.organization o ON o.id=t.organization_id
    WHERE o.subdomain='demo' AND t.task_kind='ritual_instance' AND NOT t.is_deleted) AS instances;
SQL
```

**Expected**: `3 | 6 | 2`.

## 3. Let the sweeps run, then confirm the late instance is still late

The reconciliation sweep runs every 5 minutes and is the only thing that can write a ritual
instance's state. Leave the backend up for six minutes, then:

```bash
psql "$DATABASE_URL" -c "
SELECT t.identifier, ps.category, ps.is_closed
FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
JOIN public.organization o ON o.id = t.organization_id
WHERE o.subdomain='demo' AND t.task_kind='ritual_instance' AND NOT t.is_deleted
ORDER BY t.scheduled_date;"
```

**Expected**: two rows — the earlier-dated one `overdue | f`, the today-dated one
`todo | f`. **Not** `missed`, which is closed and would empty Today and the Team block.

Confirm the generation sweep added nothing:

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) FROM collaboration.task t
JOIN public.organization o ON o.id=t.organization_id
WHERE o.subdomain='demo' AND t.task_kind='ritual_instance' AND NOT t.is_deleted;"
```

**Expected**: `2`, still, after six minutes with the backend up.

## 4. The deletion a reviewer is asked to perform

Sign into the mobile app (`make dev-mobile`) as the **spare** credential from step 1.

> More → Settings → Account → **Delete my account**

**Expected**: the preview screen lists what is erased and what is kept, and names **no
blocking workspace**. Typing the confirmation phrase is accepted. You are signed out.
Signing in again with that credential fails.

Then sign in as the **primary** credential.

**Expected**: the workspace is intact — Site updates still has its six messages including
the reportable one, My Work still lists work, Today still has a late item, and the workspace
still has an owner.

Re-run the seed and confirm the spare credential signs in again.

## 5. The phone is not empty

Sign in on mobile as each of the three credentials in turn.

| Screen | Expected |
|---|---|
| **My Work** (Focus) | at least one item; no `Nothing to work right now` |
| **Today** | at least one of `Running late` / `Due today` populated; no `Nothing due today` |
| **Today**, as either owner | the Team block lists the late `Open-up checks` and, on a device whose local date matches the server's, the unheld one |
| **Chat** | Site updates, six messages |

**Expected overall**: zero of the four tabs shows a whole-screen empty state (SC-003).

Do this on an Android emulator as well as an iOS simulator — the habitual test device is an
iPhone SE, and a narrow-Android regression would otherwise go unnoticed.

---

## Automated checks

```bash
cd backend && go test ./integration/... -run 'TestDemoSeed' -v
cd backend && go test ./integration/...              # the whole suite must pass
make check-store-manifest                            # reviewer-notes edit must not regress it
```

**Expected**: the `-v` output reads as the behaviour list in
[contracts/test-scenarios.md](contracts/test-scenarios.md), and every suite passes.

## Failure injection (FR-018)

On a scratch edit that is never committed, delete the `Overdue` state from the demo `OPS`
project and re-run the seed.

**Expected**: exit non-zero, with a message naming the project and the missing category —
not a silent half-shaped workspace. Restore by dropping and reseeding the demo organization.
