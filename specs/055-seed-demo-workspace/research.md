# Research: A demo workspace a reviewer can finish

**Branch**: `055-seed-demo-workspace` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

Every question below was answered against the code, not against the numbered specs. The
living snapshots `docs/domain/rituals-tasks.md`, `docs/domain/auth-identity.md` and
`docs/domain/compliance-safety.md` were the entry points; file and line references are to
the code that decides the behaviour.

---

## R1 — What exactly refuses the deletion today, and what clears it

**Decision**: Seed a **second self-registered owner**. Nothing in the product changes.

`AccountDeleter.SurveyOrganizations` (`backend/internal/iam/logic_account_deletion.go:92-133`)
sets `BlocksDeletion = isOwner && ownerCount <= 1 && memberCount > 0`, where

- `ownerCount` is `CountOrganizationOwners` — active employees holding a role with
  `source_default_role_id = 'owner'` (`backend/database/scripts/iam.query.sql:820-830`);
- `memberCount` is `CountActiveOrganizationMembers` — active employees **excluding the
  person deleting** (`iam.query.sql:832-840`).

Today the demo workspace has exactly one owner and one worker, so `ownerCount = 1` and
`memberCount = 1`, and the refusal is correct. Adding a second owner makes `ownerCount = 2`
and the first clause fails for both owners. No guard is touched.

**Rationale**: the guard is right; the fixture is the thing that is wrong.

**Alternatives considered**:
- *Emptying the workspace so `memberCount = 0`* — would delete the worker account that
  demonstrates the removal-request path (FR-007).
- *Adding a bypass flag* — explicitly out of scope, and would put a deletion bypass in
  production code to serve a fixture.

---

## R2 — How a second self-registered owner is created without a second organization

**Decision**: Mirror steps 2–6 of `RegisterOrganizationWithAdmin`
(`backend/internal/organization/logic.go:274-397`) against the **existing** organization —
`iam.identity`, `organization.employee`, `iam.user` (leaving `is_org_managed` at its `FALSE`
default), `AcceptTerms`, `CreatePasswordCredential`, then `AssignRoleToEmployee` with the
organization's `owner` role. Do **not** call `RegisterOrganizationWithAdmin`, which would
create a second organization and a second default project.

The three invariants that make this work:

1. `iam.user.id` **must equal** `organization.employee.id` **must equal** `iam.identity.id`.
   The JWT `sub` carries `iam.user.id` and every org-scoped service treats it as
   `employee_id` (`logic.go:319-322`).
2. `iam.user.is_org_managed` decides which account-ending path the settings screen offers
   (`docs/domain/auth-identity.md:159-166`). Leaving it `FALSE` is what satisfies FR-003.
3. `accepted_terms_version` must be recorded in the same write, because no account may
   exist without a stored acceptance (`logic.go:338-346`).

**Rationale**: this is the smallest write that produces an account indistinguishable from a
self-registered one. Going through `AcceptInvitation` would need an `iam.invitation` row, an
email round trip and a token, to reach the same five rows.

**Alternatives considered**:
- *`InviteUser` + `AcceptInvitation`* — produces the right account but needs an invitation
  token the seed would have to mint and consume itself.
- *`iam.CreateOrgAccount`* (what the worker uses) — sets `is_org_managed = TRUE`, which is
  exactly the wrong path (FR-003).

---

## R3 — What is left behind when the spare owner is deleted, and how a re-run restores it

**Decision**: On each run, look for an **active** employee carrying the spare owner's email.
If there is none, create the account from scratch with a fresh UUID. Leave the anonymised
tombstone alone.

Deletion is anonymisation at the tenant layer and destruction at the global layer
(`docs/domain/auth-identity.md:167-176`). Concretely, after the reviewer deletes the spare
owner:

- `organization.employee` survives with `given_name = 'Deleted'`, `family_name = 'user'`,
  `email = ''`, `is_active = FALSE` (`iam.query.sql:864-888`);
- `iam.identity`, `iam.credential`, `iam.employee_role` and the row's preferences are
  deleted (`logic_account_deletion.go:182-224`);
- `iam.user` is destroyed once no membership remains anywhere, cascading to
  `password_credential` and `session`.

So the seed cannot "undelete" the row — `iam.identity`, which carries the FK the employee
row depends on, is gone. It must create a new one.

[ASSUMPTION: a re-run after a demonstrated deletion leaves the anonymised tombstone in
place and creates a second, fresh employee row for the spare owner. Reusing the tombstone
would mean resurrecting a row the erase job deliberately de-identified, which is the one
thing an erasure guarantee must not do. The tombstone is `is_active = FALSE`, so it is
excluded from `CountOrganizationOwners`, `CountActiveOrganizationMembers` and the people
directory, and is invisible to a reviewer.]

**Alternatives considered**:
- *Reversing the anonymisation* — writes the deleted person's name back into a row the
  product promised to de-identify.
- *Deleting the tombstone* — roughly fifty columns across a dozen schemas reference an
  employee id (`iam.query.sql:869-873`); this is the sprawl the anonymise design exists to
  avoid.

---

## R4 — Which project the seeded work goes into

**Decision**: two projects.

- The six ordinary work items go into the existing default project **General / `GEN`**,
  created by registration (`backend/internal/organization/logic.go:404-429`).
- The recurring job and its two instances go into a **new ritual-mode project,
  Site operations / `OPS`**, created by the seed through
  `CollaborationLogic.CreateProject`.

This overrides the spec's assumption that everything goes into the default project, for a
reason the spec could not have known.

A ritual instance's lateness is a `collaboration.project_state` row, not a computed value
(`docs/domain/rituals-tasks.md:765-768`). `General` is created in `standard` collaboration
mode, so its only states are `Backlog / todo`, `In Progress / in_progress` and
`Done / done`, all `state_type = 'standard'`
(`backend/internal/collaboration/constants.go:495-506`). There is **no state in the
`overdue` category**, and nothing upgrades a project's mode when a ritual is added to it —
`CreateProject` picks the state set once, from the requested mode
(`project_logic.go:91-107`). A ritual in `General` therefore could not be late, which is
half of what this feature exists to show.

`ritual` mode seeds all eight ritual states including `Overdue / overdue`
(`is_closed = FALSE`) and `Missed / missed` (`is_closed = TRUE`)
(`constants.go:509-525`).

[ASSUMPTION: the recurring job gets its own ritual-mode project rather than converting
`General` to `mixed`. A second project named for the work it holds is the ordinary shape of
a small business's workspace and is what a reviewer expects to see; converting the default
project's collaboration mode after the fact has no supported path and would leave the demo
workspace shaped unlike any real one.]

**Rationale**: it is also the honest answer — recurring operational jobs live in their own
project in real workspaces.

**Alternatives considered**:
- *Adding the eight ritual states to `General` by hand* — produces a project the product
  itself would never create, and `General`'s `collaboration_mode` would still read
  `standard`, so the clients would render the wrong lane.
- *Putting the tasks in `OPS` too* — leaves the default project empty, which is the empty
  state this feature exists to remove.

---

## R5 — Keeping the late instance late

**Decision**: seed the late instance **directly into the `Overdue` state**, with
`completion_deadline = now - 48h`, `due_date = scheduled_date = today - 2`, and the
definition's `completion_window_hours = 720` (30 days).

`determineRitualTaskStateCategory`
(`backend/internal/collaboration/ritual_task_state.go:283-323`) decides, in order:
all-required-approved → `verified`; all-required-submitted → `submitted`;
`now > deadline + graceWindow` → `missed`; `now > deadline` → `overdue`; any submission →
`in_progress`; future `scheduled_date` → `scheduled`; otherwise `todo`. `graceWindow` is the
definition's `completion_window_hours` (`ritual_task_state.go:230`).

The reconciliation sweep runs every **5 minutes**
(`constants.go:431`, `cmd/server.go:500-502`) and its candidate predicate includes
`overdue`, precisely so an instance can reach `missed`
(`backend/database/scripts/collaboration.query.sql:873-890`). With the default
`completion_window_hours = 24`, an instance two days late would be rewritten to `missed`
within five minutes of the seed landing — and `Missed` is `is_closed = TRUE`, so it would
vanish from Today, My Work and the Team block at once. A 30-day grace window keeps it
`overdue` for a month, which is longer than any review queue.

Because the seeded state already equals the derived state, the compare-and-set writes
nothing and no duplicate overdue notification is published
(`ritual_task_state.go:126-206`).

**Rationale**: one column on the definition, chosen so the product's own authority agrees
with the fixture instead of fighting it.

**Alternatives considered**:
- *`completion_deadline = NULL`* — excluded from the sweep entirely
  (`collaboration.query.sql:880`), so the row would be frozen; rejected because an overdue
  instance with no deadline is a state the product cannot otherwise produce, and a reviewer
  opening it would see a contradiction.
- *A deadline inside the default 24-hour grace window* — a drifting target that goes wrong
  the moment the seed is run at the wrong hour.
- *`detached_from_ritual = TRUE`* — removes it from the ritual entirely.

---

## R6 — Stopping the generation sweep from burying the two seeded instances

**Decision**: an **active** definition with a `monthly` recurrence whose `day_of_month` is
the seed day (clamped to 28), `generation_window_days = 1`, and
`last_generated_date = CURRENT_DATE`.

`ritual_generation_sweep` runs every **1 minute** (`cmd/server.go:481-483`) and selects
definitions where `is_archived = FALSE AND (last_generated_date IS NULL OR
last_generated_date < target_date + generation_window_days)`
(`collaboration.query.sql:812-817`). Dates come from `computeDatesInWindow`
(`scheduler_logic.go:332-380`) over `[last_generated_date + 1, now + generation_window_days]`.

With the chosen values the window is a single day — tomorrow — and a monthly rule yields no
date in it. The next date the rule produces is a month away, and when it arrives the
generated instance is a legitimate future run rather than a duplicate of anything seeded.
The instance the seed writes for *today* is on the same `scheduled_date` the rule would
itself produce, so `CheckRitualInstanceExists`
(`collaboration.query.sql:1135-1144`) and the partial unique index
`idx_task_ritual_instance_unique` (`schema.sql:5642`) both suppress a second copy.

**Rationale**: the definition reads as live, which is what a reviewer should see, and the
instance count is stable between two back-to-back seed runs (SC-005).

**Alternatives considered**:
- *`is_archived = TRUE`* — the only setting that stops generation permanently, but the
  ritual then reads as switched off on `rituals/[definitionId]`, and archiving through the
  RPC also soft-deletes pending instances.
- *A daily rule with a small window* — drips one instance per day, which breaks SC-005 the
  moment a sweep fires between two runs.
- *A deliberately unparseable or date-less rule* (`monthly` with no `day_of_month`, which
  `scheduler_logic.go` silently yields nothing for) — depends on a guard that is a bug
  rather than a contract.

---

## R7 — What makes the Team block on Today non-empty for an owner

**Decision**: the late instance is assigned to the **worker**, the unassigned instance is
dated **today** and has no `task_assignee` row at all, and both owners hold an
`owner`/`admin` `project_membership` row on `OPS`.

`GetTeamAttentionSummary` (`collaboration.query.sql:1749-1942`,
`backend/internal/collaboration/team_attention_logic.go:77-131`) has two disjoint legs over
a shared base predicate: `task_kind = 'ritual_instance'`, not deleted, not detached,
`ps.is_closed = FALSE`, project not archived, caller holds `project_membership` with
`role IN ('owner','admin')`, and the instance is **not assigned to the caller**.

| | Overdue (rank 0) | Unassigned (rank 1) |
|---|---|---|
| State | `ps.category = 'overdue'` | `ps.category <> 'overdue'` |
| Date | unbounded | `t.scheduled_date = as_of_date` — **equality** |
| Assignment | any | no `task_assignee` with `role = 'assignee'` |

Two consequences the fixture must respect:

- The base predicate excludes work assigned to the caller, so an instance assigned to an
  owner would be invisible in that owner's own Team block. FR-014 is therefore load-bearing,
  not cosmetic.
- `can_supervise` additionally requires the `collab.reviewEvidence` permission; a caller
  without it gets an **empty** summary rather than `PERMISSION_DENIED`
  (`ritual_connect.go:531-566`). The default `owner` role is granted it by
  `20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql`.

`as_of_date` is the **client's local date**, sent explicitly by the mobile screen
(`(today)/index.tsx:467, 500-508`). A reviewer whose device date differs from the server's
sees no unassigned row; the overdue row has no date bound and keeps the block populated
regardless, which is the mitigation the spec already assumed.

---

## R8 — What makes "Running late" and "Due today" non-empty

**Decision**: seed standard tasks with a non-null `due_date` at or before today, an open
state, and a `task_assignee` row with `role = 'assignee'` for every credential.

`GetAssignedWorkSummary` (`collaboration.query.sql:341-406`,
`context_rail_logic.go:17-78`) requires all of `ta.role = 'assignee'`,
`t.is_deleted = FALSE`, `ps.is_closed = FALSE`, `t.due_date IS NOT NULL` and
`t.due_date <= as_of_date`. The bucket is
`CASE WHEN ps.category = 'overdue' OR t.due_date < as_of_date THEN 'overdue' ELSE 'due_today' END`
— the stored state wins for rituals, the date decides for standard tasks.

`as_of_date` here is the **server's** `time.Now()`, deliberately unlike the Team block
(`docs/domain/rituals-tasks.md:791-798`).

Today's whole-screen empty state fires only when there is no overdue item **and** no
due-today item **and** no event (`(today)/index.tsx:592-595`); the Team block is excluded
from that test on purpose. The existing seeded calendar event is dated *tomorrow*, so it
does not help. Seeding at least one task due before today and one due today satisfies
FR-011 and SC-004 directly.

My Work's Focus mode fans out per project — `listProjects()`, then `listTasks` with
`assigneeEmployeeId` per project (`(tasks)/index.tsx:1083-1167`) — so a credential only sees
seeded work in a project it is a **member** of. `General` is private
(`organization/logic.go:410`), so the worker and the spare owner need explicit
`project_membership` rows.

---

## R9 — Refreshing rather than appending

**Decision**: each run hard-deletes every task in `GEN` and `OPS` and the seeded ritual
definition, resets `project.next_task_number` and `project.task_count`, then rewrites the
content — the same shape as the existing message refresh
(`backend/cmd/seed_demo.go:262-266`).

Every child of `collaboration.task` cascades on delete: `task_assignee`
(`schema.sql:7078`), `evidence_submission` (`7142`), workflow rule executions (`7166`),
custom field values (`7198`) and ritual pool assignments (`7286`). Only `fk_task_parent` is
`RESTRICT` (`7374`), and the seed writes no subtasks. So one scoped `DELETE` is sufficient
and cannot strand a child row.

`next_task_number`, `task_count` and `member_count` are denormalised counters
(`schema.sql:890-908`) that a direct write must maintain by hand.

[ASSUMPTION: the refresh deletes *all* tasks in the two demo projects, including any a
reviewer created, rather than only the rows the seed recognises. "Refresh the demo
workspace" is what the command means, the existing message seed already behaves this way,
and identifying seeded rows by title would break the moment somebody edits one.]

---

## R10 — Failing loudly on a missing workflow state (FR-018)

**Decision**: a single `requireProjectState(ctx, orgID, projectID, category, stateType)`
helper that returns
`fmt.Errorf("demo project %s has no %s state in category %q; reseed the project", ...)`
when the lookup finds no row, called before any task is written.

The product's own behaviour in this situation is to leave the instance where it is and log
at WARN (`ritual_task_state.go:172-182`) — correct for a live system, wrong for a fixture,
where a half-shaped workspace reaches a reviewer silently. `project_state` also carries
`UNIQUE (organization_id, project_id, position)` (`schema.sql:4264`), so the helper looks up
by `(category, state_type)` and never by position.

---

## R11 — Where the seed uses the logic layer and where it writes rows directly

**Decision**: use the logic layer for anything with an invariant the seed would otherwise
re-implement, and write rows directly only where the logic layer cannot express the state.

| Thing | How | Why |
|---|---|---|
| Spare owner | direct rows, mirroring `RegisterOrganizationWithAdmin` steps 2–6 | no logic-layer call creates a second owner in an existing org without an invitation |
| `OPS` project | `CollaborationLogic.CreateProject` | gets 8 ritual states, 4 task levels, the owner membership and the counters right in one call |
| Project memberships | direct rows | a three-row insert against a table with one unique key |
| Six work items | direct rows | needs `identifier`, `level_id`, `state_id` and the project counters, all of which the seed already holds; going through `CreateTask` would need a per-task RPC context |
| Ritual definition | direct rows | needs `last_generated_date` and `generation_window_days` set to values `CreateRitualDefinition` would overwrite by generating inside its own transaction |
| Two instances | direct rows | the `overdue` state and the past `completion_deadline` are states no create path produces |

This follows the file's existing stance — "this is a development fixture, not a user action,
and going through five service layers would make the command a second implementation of
half the product" (`seed_demo.go:236-238`) — while still reusing `CreateProject`, which
would otherwise be forty lines of state and level inserts.

---

## R12 — Things that stay exactly as they are

- The sole-owner guard, `DeleteMyAccount`, `RequestAccountRemoval` and the confirmation
  phrase. This feature adds no product behaviour and changes no RPC surface.
- The worker account, its permanent PIN and its removal-request path (FR-007).
- The `site-updates` channel, its six messages including the reportable one, and the
  calendar event.
- `make check-store-manifest`, which scans `docs/compliance/*.md` for claims outside their
  declared recorded-absence sections
  (`frontend/apps/mobile/scripts/check-store-manifest.js`). The reviewer-notes edit adds a
  third credential and a deletion instruction; it must not introduce a capability claim
  outside `### Not requested`.
