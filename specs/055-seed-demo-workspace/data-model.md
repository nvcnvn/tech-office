# Data Model: A demo workspace a reviewer can finish

**Branch**: `055-seed-demo-workspace` | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

No migration. No new table, column, constraint or index. Every row below is written into a
table that exists today, by `backend/cmd/seed_demo.go`.

---

## The workspace the seed leaves behind

```
public.organization  subdomain = "demo"  (one, refreshed on re-run)
├── organization.employee × 3 active
│   ├── Ana Reviewer      owner@demo.demo.invalid     self-registered   owner role
│   ├── Ben Keeler        spare@demo.demo.invalid     self-registered   owner role   ← NEW, disposable
│   └── Sam Field         demo-worker (PIN)           org-managed       member role
├── chat.channel "site-updates" + 6 messages           (unchanged)
├── calendar.event "Hillside site visit"               (unchanged)
├── collaboration.project "General" / GEN  standard    (exists; now populated)
│   └── collaboration.task × 6, standard
└── collaboration.project "Site operations" / OPS  ritual   ← NEW
    └── collaboration.ritual_definition "Open-up checks"    ← NEW
        └── collaboration.task × 2, ritual_instance         ← NEW
```

---

## 1. Spare owner

One account, five rows, all in the existing organization. Ids are one UUID used three times
— `iam.identity.id = organization.employee.id = iam.user.id` is the invariant the JWT `sub`
claim depends on (research R2).

| Table | Row | Notes |
|---|---|---|
| `iam.identity` | `id`, `organization_id`, `email`, `identity_type = 'human'` | |
| `organization.employee` | same `id`, `given_name = 'Ben'`, `family_name = 'Keeler'`, `email`, `is_active = TRUE` | |
| `iam.user` | same `id`, `email`, `display_name = 'Ben Keeler'`, `status = 'active'`, `is_org_managed = FALSE` (**default — never set TRUE**) | FR-003 |
| `iam.user` (update) | `terms_version_accepted = iam.CurrentTermsVersion`, `terms_accepted_at = now()` | no account may exist without a stored acceptance |
| `iam.password_credential` | `user_id`, `password_hash = iam.HashPassword(password)` | |
| `iam.employee_role` | `employee_id`, `role_id` = the org role with `source_default_role_id = 'owner'` | FR-001 |

**Credential**: `spare@demo.demo.invalid`, password shared with the primary owner's
`--owner-password` flag unless a new `--spare-password` flag is given.

[ASSUMPTION: the spare owner is named `Ben Keeler` at `spare@<subdomain>.demo.invalid`,
parallel to the existing `owner@<subdomain>.demo.invalid`. `.demo.invalid` is already the
seed's reserved, undeliverable domain.]

**Idempotency** (FR-006, research R3): the seed looks up
`organization.employee WHERE organization_id = $1 AND email = $2 AND is_active = TRUE`. Found
→ refresh the password hash and re-assert the owner role, nothing else. Not found → create
all six rows with a fresh UUID, leaving any anonymised tombstone from a prior deletion in
place.

**State after a reviewer deletes it**: employee row anonymised and `is_active = FALSE`;
`iam.identity`, `iam.credential`, `iam.employee_role` and `iam.user` gone. The seeded tasks
assigned to it keep pointing at the tombstone, which is what the anonymise design is for.

---

## 2. Project memberships

`collaboration.project_membership`, unique on `(organization_id, project_id, employee_id)`.

| Project | Primary owner | Spare owner | Worker |
|---|---|---|---|
| `GEN` | `owner` (already exists, created with the project) | `admin` | `member` |
| `OPS` | `owner` (created with the project) | `admin` | `member` |

Both owners need `owner`/`admin` on `OPS` or their Today Team block is empty — the
supervisory scope is exactly those two roles (research R7). All three need *some* membership
on both projects or My Work's per-project fan-out never asks about them (research R8), since
both projects are `private`.

`project.member_count` is incremented for each row added.

---

## 3. Six work items — `collaboration.task`, `task_kind = 'standard'`, project `GEN`

States are looked up by category, never by name or position (FR-018, research R10):

- `Backlog` — `category = 'todo'`, `state_type = 'standard'`, `is_initial`, open
- `In Progress` — `category = 'in_progress'`, `state_type = 'standard'`, open

`level_id` is the project's `depth = 0` level (`Epic`); `reporter_employee_id` is the primary
owner; `identifier` is `GEN-1` … `GEN-6`; `depth = 0`, `path = '{}'`.

| # | Title | State | Assignee | `due_date` |
|---|---|---|---|---|
| 1 | Order two more scaffold boards for Hillside | In Progress | Sam Field (worker) | `today - 3` |
| 2 | Send the Hillside first-fix invoice | In Progress | Ana Reviewer (primary owner) | `today - 1` |
| 3 | Book the skip for Thursday | Backlog | Ben Keeler (spare owner) | `today` |
| 4 | Confirm the gate code with the site manager | Backlog | Sam Field (worker) | `today` |
| 5 | Chase the electrician's certificate | Backlog | Ana Reviewer (primary owner) | `today + 2` |
| 6 | Price up the Meadow Lane extension | Backlog | Ben Keeler (spare owner) | `today + 5` |

Each row gets exactly one `collaboration.task_assignee` with `role = 'assignee'` and
`assigned_by_employee_id` = primary owner.

Why this distribution:

- Two states, both open, four in one and two in the other → FR-009, and a board that shows
  movement.
- Every credential holds two items → FR-010, and My Work is populated for all three.
- Items 1 and 2 are late, items 3 and 4 are due today → FR-011 and SC-004, for the worker
  *and* both owners. `due_date IS NOT NULL AND <= today` is the Today predicate
  (research R8); items 5 and 6 sit outside it so My Work's "Upcoming" section is not empty
  either.
- Titles are the same business as the seeded conversation — the Hillside job, the scaffold
  boards, the invoice → FR-012.

`project.task_count` is set to 6 and `project.next_task_number` to 7.

---

## 4. `Site operations` project — `collaboration.project`, `collaboration_mode = 'ritual'`

Created through `CollaborationLogic.CreateProject` (research R11), which in one transaction
writes the project, **eight** `project_state` rows from `DefaultRitualProjectStates` (all
`state_type = 'ritual'`, `Scheduled` initial, `Overdue` open, `Missed`/`Verified`/`Skipped`
closed), **four** `task_level` rows, and the creator's `owner` membership.

| Field | Value |
|---|---|
| `name` | `Site operations` |
| `key` | `OPS` (matches `^[A-Z][A-Z0-9_]{0,9}$`) |
| `description` | `Recurring checks the crew runs on every site.` |
| `visibility` | `private` |
| `collaboration_mode` | `ritual` |
| creator | primary owner |

**Idempotency**: looked up by `(organization_id, key = 'OPS')`; created only when absent.

---

## 5. Recurring job — `collaboration.ritual_definition`

| Column | Value | Why |
|---|---|---|
| `project_id` | `OPS` | ritual states (research R4) |
| `name` | `Open-up checks` | |
| `description` | `Gate, scaffold and first-aid kit, before anyone starts work.` | |
| `recurrence_rule` | `{"type":"monthly","interval":1,"day_of_month":<min(today.Day,28)>,"time_of_day":"08:00"}` | yields no date inside the generation window (research R6) |
| `completion_window_hours` | `720` | keeps the late instance `overdue` for 30 days instead of `missed` in 5 minutes (research R5) |
| `generation_window_days` | `1` | one-day lookahead |
| `last_generated_date` | `CURRENT_DATE` | window is `[tomorrow, tomorrow]` |
| `timezone` | `UTC` | the column default; the seed writes dates, not wall clocks |
| `is_archived` | `FALSE` | FR-017 is met by the window, not by switching the ritual off |
| `created_by_employee_id` | primary owner | |

One `collaboration.evidence_requirement` row: `evidence_types = {photo}`, `is_required`,
`position = 0`, `approval_mode = 'manual'`, `deadline_offset_hours = 0`.

[ASSUMPTION: one required photo requirement is seeded. A ritual is defined as a recurring job
*with mandatory evidence*, so a definition with none would read as unfinished, and an
instance with zero required evidence still derives `overdue` identically (research R5). It
also gives a reviewer a real evidence flow to open.]

**Idempotency**: looked up by `(organization_id, project_id, name)`; updated in place when
found, so its id is stable across runs.

---

## 6. Two instances — `collaboration.task`, `task_kind = 'ritual_instance'`, project `OPS`

Both carry `ritual_definition_id`, `is_deleted = FALSE`, `detached_from_ritual = FALSE`,
`depth = 0`, `path = '{}'`, `level_id` = the `OPS` depth-0 level, `reporter_employee_id` =
primary owner. `scheduled_date` must differ between them — the partial unique index
`idx_task_ritual_instance_unique` is on `(organization_id, ritual_definition_id,
scheduled_date)`.

### 6a. The late one — `OPS-1`

| Column | Value |
|---|---|
| `title` | `Open-up checks` |
| `scheduled_date` | `today - 2` |
| `start_date` / `due_date` | `today - 2` (so it reaches Today's "Running late") |
| `completion_deadline` | `now - 48h` |
| `state_id` | the `OPS` state with `category = 'overdue'`, `state_type = 'ritual'` |
| assignee | **Sam Field (worker)** — `task_assignee`, `role = 'assignee'` |

Assigned to the worker, never an owner, because the Team block excludes instances assigned
to the caller (FR-014, research R7). With a 720-hour grace window the reconciliation sweep
re-derives `overdue`, the compare-and-set matches the stored state, and nothing is written
or re-notified.

### 6b. The one nobody is holding — `OPS-2`

| Column | Value |
|---|---|
| `title` | `Open-up checks` |
| `scheduled_date` | `today` — **equality** is what the unassigned leg matches |
| `start_date` / `due_date` | `today` |
| `completion_deadline` | `now + 690h` (scheduled date + `completion_window_hours`, still in the future) |
| `state_id` | the `OPS` state with `category = 'todo'`, `state_type = 'ritual'` (`Open`) |
| assignee | **none** — no `task_assignee` row at all |

`todo` is neither `overdue` nor closed, which is what the unassigned category requires
(FR-016). A future `completion_deadline` also keeps it out of the reconciliation sweep's
candidate set entirely.

`OPS.task_count = 2`, `OPS.next_task_number = 3`.

---

## 7. The refresh (FR-019, research R9)

On every run, in this order, before anything is written:

1. `DELETE FROM collaboration.task WHERE organization_id = $1 AND project_id IN (GEN, OPS)`
   — `task_assignee`, `evidence_submission`, workflow executions, custom field values and
   ritual pool assignments all cascade.
2. `DELETE FROM collaboration.evidence_requirement` for the seeded definition.
3. Reset `next_task_number = 1`, `task_count = 0` on both projects.

The ritual definition itself is updated, not deleted, so its id survives a re-run.

---

## 8. Reviewer notes — `docs/compliance/reviewer-notes.md`

Not a database entity, but part of the deliverable (FR-002, FR-008).

| Change | Requirement |
|---|---|
| `### 1. Self-registered owner (use this one)` keeps its billing as the primary credential, and its deletion paragraph is rewritten to point at credential 2 | FR-002 |
| New `### 2. Spare owner — delete this one` between the existing 1 and 2, with email, password, and a plain statement that deleting it leaves the workspace and the primary credential usable | FR-002, FR-008 |
| The existing worker section renumbers to `### 3`, unchanged in substance | FR-007 |
| `### Account deletion` names credential 2 explicitly and states the reviewer only needs to do it once | FR-008, edge case 2 |

The three credentials appear in one place, primary first, with exactly one marked as the one
to delete. No capability claim is added outside `### Not requested`, so
`make check-store-manifest` still passes (research R12).

---

## 9. Printed output — `printDemoCredentials` (FR-021)

Three blocks in this order: PRIMARY (owner email/password), SPARE — DELETE THIS ONE
(spare email/password, with the one-line reason), SECOND PATH (worker workspace/login/PIN).
The existing test asserts `PRIMARY credential` precedes `SECOND credential`; the spare block
goes between them and carries its own marker string.
