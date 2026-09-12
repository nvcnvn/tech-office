---
description: "Task list for 057-composite-fk-set-null"
---

# Tasks: Composite Foreign Keys Stop Nulling the Tenant Column

**Input**: Design documents from `/specs/057-composite-fk-set-null/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/referential-actions.md](./contracts/referential-actions.md), [quickstart.md](./quickstart.md)

**Tests**: Integration tests and linter unit tests ARE included — the spec requires them (Story 1's and Story 3's Independent Test clauses, Constitution principle II).

**Organization**: Tasks are grouped by user story. Story 1 is the defect and the MVP; Story 2 and Story 3 each add an independently testable increment on top of it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Backend-only change. Paths are repo-relative from `/Volumes/T5/Codes/tech-office`:

- Migrations: `backend/database/migrations/`
- Generated snapshot: `backend/database/scripts/schema.sql` (never hand-edited)
- Linter: `backend/tools/tenancylint/`
- Logic layer: `backend/internal/collaboration/`
- Integration tests: `backend/integration/`
- Domain docs: `docs/domain/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get a live PostgreSQL 18 to run migrations and integration tests against. No project scaffolding is needed — every file this feature touches already exists.

- [X] T001 Start the project's PostgreSQL 18 container and confirm connectivity: `cd backend && cp -n .env.example .env && docker compose up -d postgres`, then `export DATABASE_URL='postgres://postgres:tech_office_password@localhost:15432/tech_office_db?sslmode=disable'` and verify with `psql "$DATABASE_URL" -c 'select version()'` — expect PostgreSQL 18 (per quickstart.md Prerequisites)
- [X] T002 Record the pre-change baseline so the snapshot diff in T005 is reviewable: run `cd backend && ./scripts/migrate.sh` to bring the database to head, then `git status --porcelain backend/database/scripts/schema.sql` must be clean

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema change itself. Every user story depends on it — Story 1 is its behaviour, Story 2 is its consequence for the seed, Story 3 lints the schema it produces (and would fail the build if it ran first, per plan.md "Implementation order").

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create the migration `backend/database/migrations/20260912000001_composite_fk_set_null_columns.up.sql` containing all five constraint changes, each preceded by a comment saying why, using `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT` for idempotency (forward-only, no `.down.sql`, matching the existing files in that directory):
  1. `collaboration.task` — replace `fk_task_source_message` with `FOREIGN KEY (organization_id, source_message_id) REFERENCES chat.message(organization_id, id) ON DELETE SET NULL (source_message_id)`
  2. `collaboration.task` — replace `fk_task_source_channel` with `FOREIGN KEY (organization_id, source_channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE SET NULL (source_channel_id)`
  3. `collaboration.task` — `DROP CONSTRAINT IF EXISTS task_source_message_consistency` with a comment recording research R2/R3: both `(NULL, message)` and `(channel, NULL)` are reachable intermediate states, a row-level CHECK is never deferrable, so no CHECK relating the two columns can hold
  4. `chat.channel_membership` — replace `fk_channel_membership_last_viewed_message` with `FOREIGN KEY (organization_id, last_viewed_message_id) REFERENCES chat.message(organization_id, id) ON DELETE SET NULL (last_viewed_message_id)`, commenting that unread counts are computed from `last_viewed_at`, not this pointer (`chat.query.sql:756`)
  5. `voice.voice_message` — replace `fk_voice_message_message` with `FOREIGN KEY (organization_id, message_id) REFERENCES chat.message(organization_id, id) ON DELETE CASCADE`, commenting that `SET NULL` is barred by `voice_message_posted_requires_assets`
- [X] T004 Apply the migration: `cd backend && ./scripts/migrate.sh` — it must apply cleanly against the container from T001
- [X] T005 Regenerate the schema snapshot: `cd backend && ./scripts/regen-schema.sh`, then review `git diff backend/database/scripts/schema.sql` — expect exactly four FK constraint lines changed and one `CHECK` line removed (`task_source_message_consistency` at `schema.sql:1206`). Never hand-edit this file (FR-008)
- [X] T006 Verify the column list survived `pg_dump` (research R1 — the linter in Story 3 parses this file, so if the dump dropped the column list the rule would flag the very constraints this feature fixes): `grep -E 'fk_task_source_(message|channel)|fk_channel_membership_last_viewed|fk_voice_message_message' backend/database/scripts/schema.sql` must show `ON DELETE SET NULL (source_message_id)`, `ON DELETE SET NULL (source_channel_id)`, `ON DELETE SET NULL (last_viewed_message_id)` and `ON DELETE CASCADE`, and `grep -n 'ON DELETE SET NULL;' backend/database/scripts/schema.sql` must return nothing
- [X] T007 Confirm the existing backend build and tenancy linter still pass on the new snapshot before any story work: `cd backend && go build ./... && make -C .. lint-tenancy`

**Checkpoint**: The database now permits a hard delete of a message a task was made from. User stories can begin.

---

## Phase 3: User Story 1 - A message a task was made from can be deleted (Priority: P1) 🎯 MVP

**Goal**: Hard-deleting a chat message or channel succeeds, and every task created from it survives with its organization and every other column intact, showing no origin at all.

**Independent Test**: Create a task from a message, hard-delete that message, assert the delete returns without error and the task row is intact with a non-null `organization_id` and `has_origin: false`. Testable with nothing else in this feature built beyond Phase 2.

### Implementation for User Story 1

- [X] T008 [US1] Replace the origin block in `taskToProto` at `backend/internal/collaboration/task_logic.go:955` so it emits **both** `SourceChannelId` and `SourceMessageId` or **neither** — guard on `t.SourceChannelID.Valid && t.SourceMessageID.Valid` — and replace the comment that asserts "The table's CHECK guarantees both halves are set together" (a CHECK T003 deletes) with the real reason: storage may hold a half-present origin after a hard delete, and contract 3 requires every reader to treat that as no origin (FR-003, SC-005)
- [X] T009 [P] [US1] Verify the other two origin readers need no change and record the verification in the test from T010 rather than editing them: `GetTaskOrigin` (`backend/internal/collaboration/task_from_message_logic.go:314`) already returns `HasOrigin: false` when either half is absent, and `ListTasksBySourceMessages` (`:276`) is backed by the partial index `idx_task_source_message WHERE source_message_id IS NOT NULL`. If either does branch on one half alone, fix it here (research R5)

### Tests for User Story 1

- [X] T010 [US1] Add the delete scenarios to `TestChatTaskCapture` in `backend/integration/chat_task_capture_test.go` as nested `t.Run` subtests following the existing testWorld arrange/act/assert pattern in that file, covering every acceptance scenario in spec.md Story 1:
  - create a task from a message, `DELETE FROM chat.message` for that row, assert no error returned (scenario 1, FR-001)
  - read the task back: it exists, `organization_id` unchanged, `identifier`, `title`, `project_id` and state unchanged, `source_message_id` now `NULL` (scenario 2, SC-002)
  - `GetTaskOrigin` returns `has_origin: false` and the task proto carries **neither** origin field (scenario 3, FR-003)
  - two tasks created from the same message both survive the delete (Edge Cases: "One message, several tasks")
  - deleting the **channel** succeeds and leaves both tasks intact with both origin columns `NULL` — this is the case that catches a re-introduced CHECK, because the channel half is nulled before the message cascade (scenario 4, FR-002/FR-004)
  - a member's `last_viewed_message_id` pointing at the message, and a posted `voice.voice_message` attached to it, neither block the delete; after it, no row references the deleted message (FR-005, contract 1)
  - a task that never had an origin is untouched throughout (scenario 5)
- [X] T011 [US1] Run `make test-backend-one T=TestChatTaskCapture` and confirm green

**Checkpoint**: FR-001 through FR-005 and SC-001/SC-002/SC-005 hold. Story 1 is independently shippable.

---

## Phase 4: User Story 2 - The demo seed re-runs against a workspace a reviewer has used (Priority: P2)

**Goal**: `seed-demo-org --subdomain demo` succeeds against a workspace a reviewer has signed into, read, converted to a task and recorded into — making the idempotency claim already published in `docs/compliance/reviewer-notes.md` true.

**Independent Test**: Seed a workspace, exercise it as a reviewer would (read the channel, create a task from a message, leave a voice message), re-run the seed, assert it exits 0 and the demo channel holds exactly one copy of the fixture.

**Depends on**: Phase 2 (the constraints are what unblock the seed's `DELETE FROM chat.message`). No seed logic change is required — research R7.

### Implementation for User Story 2

- [X] T012 [US2] Rewrite the comment at `backend/cmd/seed_demo.go:187` (the "--- 4. Content worth reviewing ---" block) so it stops asserting a constraint that no longer exists: the work-before-content ordering is now incidental, not required, because `fk_task_source_message` nulls only `source_message_id` and leaves `organization_id` alone. Do **not** change the ordering or any seed logic (FR-009, research R7)
- [X] T013 [US2] Verify no other comment or doc in the seed path still describes the old failure: `grep -rn "SET NULL" backend/cmd/ backend/internal/chat/` and reconcile anything that asserts a message cannot be deleted

### Tests for User Story 2

- [X] T014 [US2] Run the manual re-run check from quickstart.md step 4 against the container from T001: `cd backend && go run ./cmd/seed-demo-org --subdomain demo`, then exercise the workspace (sign in as the demo worker, open the demo channel to set a last-viewed pointer, convert the rude message to a task via the chat quick action, record a voice message), then re-run the same command. Assert exit 0, the demo channel holds exactly the six fixture messages once, and the reviewer's task survives without an origin (FR-006, SC-003, spec Story 2 scenarios 1–3)
- [X] T015 [US2] Confirm the never-seeded path is unchanged (Story 2 scenario 4): run the seed against a fresh subdomain and assert it behaves as it does today

**Checkpoint**: FR-006, FR-009 and SC-003 hold. The published reviewer-notes promise is now true.

> [ASSUMPTION: T014 was implemented as an integration test — a new `when a reviewer has used the workspace before the seed runs again` block in `backend/integration/demo_seed_test.go` — rather than as the manual browser walkthrough quickstart.md step 4 describes. An unattended run cannot drive a browser, and a repeatable test is what a senior engineer would leave behind for a claim published to Apple and Google. The reviewer's residue is written straight to storage because the demo accounts sign in by password and PIN and the test holds no session for them; the constraints under test do not care which statement wrote the rows, and the RPC-driven version of the same delete is `TestChatTaskCapture`'s hard-delete block.]
>
> [ASSUMPTION: the sub-assertion quickstart.md step 4 states as "the task the reviewer created survives without an origin" was found to be false and was not written. `refreshDemoProjects` (`backend/cmd/seed_demo.go`) empties the demo projects outright — "including anything a reviewer created while looking around", by its own comment — and it runs *before* the conversation is cleared, so a reviewer's captured task is deleted by the refresh and never reaches the message delete at all. What the seed was actually blocked by, and what the test now asserts, is the pair of `ON DELETE RESTRICT` dependents that the work refresh does not clear: the read receipt (`chat.channel_membership.last_viewed_message_id`) and the posted voice recording (`voice.voice_message.message_id`). FR-003's "survives without an origin" behaviour is proven by Story 1's integration test instead.]

---

## Phase 5: User Story 3 - The mistake cannot be written a third time (Priority: P3)

**Goal**: `make lint-tenancy` rejects any foreign key on a tenant table whose delete action would null the tenant column, naming the constraint and stating the fix.

**Independent Test**: Feed the linter a fixture constraint with a bare `ON DELETE SET NULL` over a composite tenant key and assert it reports a finding; feed it the column-list form and assert it passes.

**Depends on**: Phase 2 must land first — the rule reads `backend/database/scripts/schema.sql`, so running it before the migration and regeneration would fail the build on the very constraints this feature fixes (plan.md "Implementation order", Story 3 scenario 5).

### Implementation for User Story 3

- [X] T016 [US3] Split `loadSchema` in `backend/tools/tenancylint/main.go:139` into a file-reading half that keeps the name `loadSchema(path string)` and a parse half `collectSchema(src string) (map[string]*tableInfo, error)`, so the new rule can be unit-tested against DDL strings. No existing behaviour moves — this is the only refactor (research R6)
- [X] T017 [US3] Add the `fkInfo` type and collect foreign keys in `backend/tools/tenancylint/main.go` from the same walk that already collects unique keys, reading `conname`, `fk_attrs`, `fk_del_action` and `fk_del_set_cols` from `CONSTR_FOREIGN` nodes in both `CreateStmt` table elements and `AlterTableStmt` commands (the snapshot declares FKs via `ALTER TABLE ... ADD CONSTRAINT`), and store them on `tableInfo` as declared in data-model.md
- [X] T018 [US3] Add `checkForeignKeys` to `backend/tools/tenancylint/main.go` implementing rule `set-null-tenant-column`, evaluated only for tables already classified `tenant`: report a finding when `delAction ∈ {"n","d"}` AND `len(attrs) > 1` AND (`len(delSetCols) == 0` OR `organization_id ∈ delSetCols`). Emit findings in sorted order and format the message per contract 4 — naming the table and constraint, saying Postgres would null `organization_id` (NOT NULL), and stating the fix, e.g. `Write: ON DELETE SET NULL (source_message_id)`. Wire it into the same call site and exit-code-1 path as the existing `unique-key` rule (FR-007)
- [X] T019 [US3] Add Story 3's five scenarios as table-driven cases in `backend/tools/tenancylint/main_test.go`, calling `collectSchema` with DDL strings: composite `SET NULL` with no column list → finding naming the constraint; composite `SET NULL (source_message_id)` → clean; composite `SET NULL (organization_id, source_message_id)` → finding; single-column `SET NULL` on a table with no `organization_id` column → clean; and the real `backend/database/scripts/schema.sql` → no `set-null-tenant-column` findings. Also cover `SET DEFAULT` and a single-column `SET NULL` on a tenant table (clean), per the verdict table in data-model.md
- [X] T020 [US3] Run `make lint-tenancy` — expect the unit tests green and the linter reporting no findings on the fixed schema (Story 3 scenario 5, SC-004). Then prove the rule bites: temporarily delete `(source_message_id)` from the snapshot, re-run, confirm it fails naming `fk_task_source_message`, and restore with `git checkout backend/database/scripts/schema.sql`

**Checkpoint**: All three stories independently functional. FR-007 and SC-004 hold.

> [ASSUMPTION: T020's restore step was done with `backend/scripts/regen-schema.sh`, not `git checkout backend/database/scripts/schema.sql` as written. The regeneration from T005 is uncommitted at this point in the sequence, so `git checkout` discards it along with the deliberate temporary edit and leaves the snapshot at the pre-migration state — which then fails `make lint-tenancy` for real. Re-running the generator is the operation the task intended: it restores the snapshot from the migrations, which is the only thing allowed to write that file.]

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation half of the Definition of Done (Constitution principle XII) and the full gate.

- [X] T021 [P] Update `docs/domain/rituals-tasks.md` to describe what a **hard** delete now does to a task's origin — today it documents only the soft-delete case ("a soft-deleted source message does not remove the origin"). State that a hard delete nulls the origin column, the task survives with its organization intact, and a half-present origin reads as no origin everywhere (FR-008, plan.md Constitution Check XII)
- [X] T022 [P] Update `docs/domain/chat.md` with the message hard-delete contract from `contracts/referential-actions.md` §1: the delete succeeds unconditionally, replies and reactions and voice rows cascade, last-viewed pointers and task origins are nulled, and soft deletion is a separate unaffected operation
- [X] T023 Reconcile the drift register in `docs/domain/README.md` — remove any entry this feature closes, and add none that it does not create (T021 and T022 must land first so the register reflects the updated docs)
- [X] T024 Run the full gate from quickstart.md: `make lint-tenancy && make test-backend && make test-frontend`. `make test-frontend-one F=chat-task-capture` must stay green with no frontend change — the E2E run confirms both clients still gate the origin block on `sourceMessageId` alone, it is not testing new UI (SC-005)
- [X] T025 Final review pass: confirm no `.down.sql` was added (migrations are forward-only), `backend/database/scripts/schema.sql` shows only regenerated output, no proto file changed, and no file under `frontend/` changed

**Gate results**

- `make lint-tenancy` — green, including the new `set-null-tenant-column` rule and its unit tests.
- `make test-backend` — green, whole suite, exit 0.
- `make test-frontend-one F=chat-task-capture` — 8/8 green with no frontend change (SC-005).
- `make test-frontend` — 235 passed, 2 failed. Both failures are the pre-existing drift-register item [D41](../../docs/domain/README.md#drift-register): `legal-surface.spec.ts:59` and `user-guide-screenshots.spec.ts:626`, which fail in setup because `RegisterOrganizationWithAdminPassword` refuses the terms version their fixtures send. Neither touches chat, tasks or the schema. [ASSUMPTION: the gate is treated as met at the documented D41 baseline rather than at zero failures, because `make test-frontend` is known not to be green on a clean tree and this change set does not modify anything under `frontend/`. D41's third listed spec, `context-rail.spec.ts:155`, passed on this run.]
- Migration re-run against an already-migrated database: clean, no-op (`DROP CONSTRAINT IF EXISTS` before each `ADD CONSTRAINT`).
- T025 review: one `.up.sql` added and no `.down.sql`; `backend/database/scripts/schema.sql` shows only generator output (4 foreign-key lines, 1 `CHECK` removed); no `.proto` or generated `rpc/v1` file changed; no file under `frontend/` changed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2 only
- **User Story 2 (Phase 4)**: Depends on Phase 2; T014's assertions about the surviving task assume US1's guard, so run after Phase 3
- **User Story 3 (Phase 5)**: Depends on Phase 2 — **must not run before it**, or the linter fails the build on the schema it is being added to check
- **Polish (Phase 6)**: Depends on all three stories

### User Story Dependencies

- **US1 (P1)**: Independent once Phase 2 lands. This is the MVP.
- **US2 (P2)**: Independent of US1's Go guard for its *pass/fail* outcome (the seed succeeds on the schema change alone), but sequenced after US1 because the spec places it there and its "task survives without an origin" assertion is US1's contract.
- **US3 (P3)**: Fully independent of US1 and US2 — different files (`tools/tenancylint/`), no shared state beyond the regenerated snapshot from Phase 2.

### Within Each User Story

- Implementation before tests here, deliberately: the schema change in Phase 2 is what makes the Story 1 test able to pass at all, and a test written before T003 would fail for the right reason but block the migration behind a red suite.
- T016 (refactor) before T017 (collect) before T018 (rule) before T019 (test) — each builds on the previous in the same file.

### Parallel Opportunities

- **T021 and T022** are different documentation files with no shared content — run in parallel.
- **T009** touches different files from T008 and can be verified in parallel with writing it.
- **US3 (Phase 5) can run entirely in parallel with US1 (Phase 3) and US2 (Phase 4)** by a second engineer once Phase 2 is committed — it shares no file with them.
- Within Phase 2 nothing is parallel: T003 → T004 → T005 → T006 → T007 is a strict chain (write, apply, regenerate, verify, build).

---

## Parallel Example: Phase 6

```bash
# Documentation updates touch different files:
Task: "Update docs/domain/rituals-tasks.md with the hard-delete effect on task origin"
Task: "Update docs/domain/chat.md with the message hard-delete contract"
```

## Parallel Example: after Phase 2 commits

```bash
# Two engineers, no shared files:
Engineer A: Phase 3 (US1) — backend/internal/collaboration/, backend/integration/
Engineer B: Phase 5 (US3) — backend/tools/tenancylint/
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — database up
2. Phase 2: Foundational — the migration and snapshot (CRITICAL, blocks everything)
3. Phase 3: User Story 1 — the guard and the integration tests
4. **STOP and VALIDATE**: `make test-backend-one T=TestChatTaskCapture` green. The defect is fixed; a message a task was made from can be deleted.
5. Shippable here — this is the whole of SC-001, SC-002 and SC-005.

### Incremental Delivery

1. Phase 1 + Phase 2 → the database permits the delete
2. + US1 → the delete is proven and the proto surface is honest → **MVP**
3. + US2 → the demo seed re-runs, the published reviewer-notes promise becomes true
4. + US3 → the mistake cannot be written a third time
5. + Polish → domain docs match behaviour, full gate green

### Parallel Team Strategy

With two engineers: both land Phase 1 + Phase 2 together (it is one migration, not divisible), then A takes US1 + US2 and B takes US3. They meet at Phase 6.

---

## Notes

- `backend/database/scripts/schema.sql` is a generated `pg_dump` snapshot. It is regenerated by `backend/scripts/regen-schema.sh` in T005 and **never hand-edited** — the only exception is the deliberate temporary edit in T020, which is immediately reverted with `git checkout`.
- Migrations are forward-only; no `.down.sql` file is created. `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT` is what makes T003 re-runnable.
- No proto change, no frontend change, no data migration (research R8: the states the new constraints permit are exactly the ones the old constraints made impossible to write).
- `fk_task_channel` (the task's own comment thread) stays `ON DELETE RESTRICT` and is deliberately untouched — it is a different column from the origin and will still block deleting a channel that hosts a task thread, which is correct.
- Accepted residue, recorded in plan.md and not a regression: a cascaded voice recording leaves its `files.file_metadata` row orphaned, and `source_channel_id` may outlive `source_message_id` in storage (invisible to every reader by contract 3).
- Commit after each phase, or after each task within Phase 2.
