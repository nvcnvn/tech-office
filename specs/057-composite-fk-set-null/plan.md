# Implementation Plan: Composite Foreign Keys Stop Nulling the Tenant Column

**Branch**: `057-composite-fk-set-null` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/057-composite-fk-set-null/spec.md`

## Summary

Two foreign keys out of `collaboration.task` are declared `ON DELETE SET NULL` over the
composite key `(organization_id, source_message_id)`. PostgreSQL's bare `SET NULL` nulls
*every* column of the key, so the action it performs is "set `organization_id = NULL`", and
`organization_id` is `NOT NULL`. The delete fails outright.

The fix is PostgreSQL 15's column list: `ON DELETE SET NULL (source_message_id)`. Three
things travel with it, and all three were settled empirically against the project's own
PostgreSQL 18 container rather than reasoned about:

1. **The consistency CHECK must be dropped, not relaxed.** The spec proposed relaxing
   `task_source_message_consistency` to "a message implies a channel". Running the channel
   delete shows PostgreSQL nulls the *channel* half first, producing the intermediate row
   `(NULL, message)` — exactly the state that relaxation forbids. A row-level CHECK is never
   deferrable, so it sees that row. Since both intermediate states are reachable, any CHECK
   relating the two columns permits everything or rejects a legitimate delete. Research R2/R3.
2. **Two `RESTRICT` constraints must move.** `channel_membership.last_viewed_message_id`
   becomes `SET NULL (last_viewed_message_id)` — free, because unread badges are computed
   from `last_viewed_at`, not the pointer. `voice_message.message_id` becomes `CASCADE` —
   `SET NULL` is barred by `voice_message_posted_requires_assets`. This is not only about
   the seed: the voice-call timeline **already hard-deletes messages in production**
   (`chat/logic.go:3553`), so the last-viewed `RESTRICT` is a live bug, not a latent one.
3. **One Go guard, and a linter rule.** `taskToProto` copies the two origin columns
   independently under a comment asserting a CHECK this feature removes; it becomes emit-both
   or emit-neither. `tenancylint` learns to reject the mistake so it cannot be written a
   third time.

Net shape: one migration, one regenerated snapshot, ~40 lines of linter, a four-line Go
guard, a rewritten seed comment, tests, and the domain doc. No proto change, no frontend
change, no data migration.

## Technical Context

**Language/Version**: Go 1.25 (backend, linter); PostgreSQL 18; TypeScript 5.x (clients, unchanged here)

**Primary Dependencies**: `pganalyze/pg_query_go/v6` (the linter's real PostgreSQL parser), `pgx/v5`, `sqlc`

**Storage**: PostgreSQL 18, single node, schema-per-domain, forward-only `psql` migrations under `backend/database/migrations/`

**Testing**: Go integration tests against a live database (`backend/integration/`, testWorld pattern); table-driven unit tests for the linter; Playwright E2E for the web client

**Target Platform**: Linux server (Docker Swarm), with web and Expo clients

**Project Type**: Web service with web + mobile clients — backend-only change here

**Performance Goals**: N/A. Constraint definitions; no query plan changes. The partial index `idx_task_source_message` is untouched.

**Constraints**: `backend/database/scripts/schema.sql` is a generated `pg_dump` snapshot and must never be hand-edited; `make lint-tenancy` must stay green; migrations are forward-only and idempotent (`DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`)

**Scale/Scope**: 5 constraints, 1 migration, 1 linter rule, 1 Go call site, 1 comment, 2 test files, 1 domain doc

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | FKs reference composite keys leading with `organization_id`; `make lint-tenancy` green; migration added under `backend/database/migrations/`; `regen-schema.sh` re-run | **PASS, and strengthened.** All five constraints keep `(organization_id, …)` as the referencing key — only the *delete action's scope* narrows. The feature's third deliverable is a new machine check for this exact rule, which is how this principle says discipline should be held. The constitution already names `ON DELETE SET NULL` as permitted on a non-sharded node; this feature makes the permission safe to use. |
| **II. Scenario-First Integration & E2E Testing** | Behaviour proven by integration tests at the scenario level | **PASS.** Story 1 is an integration test in `chat_task_capture_test.go` (create from message → hard delete → assert survival). Story 2 is the seed re-run, covered by quickstart step 4. Story 3 is unit-tested in the linter. No new UI, so the existing `chat-task-capture.spec.ts` runs as a regression check rather than gaining cases. |
| **III. Two-Layer Service Architecture** | No RPC surface change | **PASS.** `taskToProto` is a logic-layer mapper; the guard stays there. |
| **IV. Cross-Domain Integration** | No cross-schema SQL joins; collaboration → chat direction preserved | **PASS.** The dependency direction is unchanged: `collaboration.task` references `chat.message`, never the reverse. |
| **V. Observability, Simplicity & YAGNI** | Simplest thing that works | **PASS.** The design *removes* a constraint rather than replacing it with a deferred constraint trigger, on evidence that no row-level constraint can hold. See Complexity Tracking. |
| **VI. Versioning & Breaking Changes** | Breaking changes ship atomically | **PASS.** The schema changes are breaking in the sense that a constraint is dropped, but no client contract changes and the whole change set is one commit. No compatibility shim, per the project's early-development stance. |
| **VIII. Cross-Stack Constant Sync** | Constants mirrored and asserted | **N/A.** No constant, enum or CHECK-backed value list changes. |
| **IX. UUID v7 & Nullable Cursor Params** | — | **N/A.** |
| **X. Structured Error Details** | — | **N/A.** The errors this feature removes were raw PostgreSQL constraint violations that no user was meant to see. |
| **XII. Living Documentation** | `docs/domain/` and `backend/docs/` updated in the same change set | **PASS, required.** `docs/domain/rituals-tasks.md` currently documents only the soft-delete case ("a soft-deleted source message does not remove the origin"); it must gain the hard-delete case. `docs/domain/chat.md` gains the message-delete contract. `docs/domain/README.md` drift register reconciled. |
| **XIII. Mobile Design & Testing** | — | **N/A.** No mobile change; the mobile task screen already gates on `sourceMessageId`. |

**Post-Phase-1 re-check**: unchanged. The design added no project, no dependency, no
abstraction and no new surface. It is three constraint edits, two constraint re-aimings,
one deletion, one guard and one lint rule.

## Project Structure

### Documentation (this feature)

```text
specs/057-composite-fk-set-null/
├── plan.md                            # This file
├── research.md                        # Phase 0 — the eight questions, answered against a live PG18
├── data-model.md                      # Phase 1 — constraint-by-constraint, before and after
├── quickstart.md                      # Phase 1 — five checks in failure order
├── contracts/
│   └── referential-actions.md         # Phase 1 — what a delete promises, and what the build rejects
└── tasks.md                           # Phase 2 — /speckit-tasks, not created here
```

### Source Code (repository root)

```text
backend/
├── database/
│   ├── migrations/
│   │   └── 20260912000001_composite_fk_set_null_columns.up.sql   # NEW — the whole schema change
│   └── scripts/
│       └── schema.sql                                            # REGENERATED, never hand-edited
├── tools/tenancylint/
│   ├── main.go                                                   # + fkInfo, collectSchema, checkForeignKeys
│   └── main_test.go                                              # + Story 3's five scenarios
├── internal/collaboration/
│   └── task_logic.go                                             # taskToProto: emit both origin fields or neither
├── cmd/
│   └── seed_demo.go                                              # rewrite the comment at :187 (FR-009)
└── integration/
    └── chat_task_capture_test.go                                 # + Story 1's delete scenarios

docs/domain/
├── rituals-tasks.md                                              # hard-delete effect on task origin
├── chat.md                                                       # message hard-delete contract
└── README.md                                                     # drift register
```

**Structure Decision**: Backend-only. The clients need no change — both the web task page
(`frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx:1041`) and the
mobile one (`frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx:1848`)
already gate the origin block on `sourceMessageId` alone, so a task that lost its message
renders as an ordinary task today. The backend guard in `taskToProto` is what makes that
independent of client behaviour rather than dependent on it.

## Implementation order

The order matters once: the linter rule must land *after* the migration and snapshot
regeneration, or the linter fails the build on the schema it is being added to check.

1. **Migration** — `20260912000001_composite_fk_set_null_columns.up.sql`. Five constraints
   replaced, one CHECK dropped, each with a comment saying why. Then `./scripts/migrate.sh`
   and `./scripts/regen-schema.sh`.
2. **Backend guard** — `taskToProto`: emit both origin fields or neither, replacing the
   comment that cites the now-deleted CHECK.
3. **Integration tests** — Story 1's scenarios in `chat_task_capture_test.go`, including the
   channel-delete case that is the regression guard against a re-added CHECK.
4. **Linter** — split `loadSchema` into a file-reading half and a parse half so the rule can
   be tested against DDL strings; add `fkInfo` collection and `checkForeignKeys`; add Story
   3's five unit cases. Run `make lint-tenancy` — the fixed schema must be clean.
5. **Seed comment** — rewrite `seed_demo.go:187` (FR-009) and confirm the re-run by hand
   (quickstart step 4).
6. **Docs** — `docs/domain/rituals-tasks.md`, `docs/domain/chat.md`, drift register.

## Complexity Tracking

No constitution gate is violated, but one design decision deviates from the spec's stated
assumption and is recorded here rather than buried in research.

| Decision | Spec's assumption | Why the plan differs |
|---|---|---|
| Drop `task_source_message_consistency` outright | "The consistency CHECK is relaxed rather than dropped" to "a message implies a channel" | The spec left this open — *"the plan may still choose the trigger if FR-002's ordering analysis demands it."* The analysis was run against PostgreSQL 18 and rules out **both** options: the relaxed CHECK fails on the channel-delete path (the channel half is nulled first, giving `(NULL, message)`), and a deferred constraint trigger would have to become a *fixing* trigger that nulls `source_channel_id` too — a stored procedure maintaining an invariant no reader can observe. Research R2/R3 has the reproduction. |
| The invariant moves to the write path and the readers | The CHECK protects "no task claims an origin whose excerpt cannot be rendered" | It still does, where it can: the conversion writes both columns in one statement in one transaction, and every reader (`GetTaskOrigin`, `ListTasksBySourceMessages`, `taskToProto`) treats a half-present origin as absent. Contract 3 in `contracts/referential-actions.md` states this so it is enforceable in review. |
| `voice_message.message_id` cascades rather than nulls | Spec left FR-005's resolution to the plan | `SET NULL` is not available: `voice_message_posted_requires_assets` requires `message_id IS NOT NULL` for a posted recording, so nulling trades a referential failure for a CHECK failure. The row is unreachable without its message, and nothing references `voice.voice_message` in turn. |

### Known residue, accepted

- **An orphaned `files.file_metadata` row** per cascaded voice recording. `fk_voice_message_file`
  is `RESTRICT` in the other direction, so it blocks nothing; the row simply loses its last
  reader. File lifetime is a pre-existing gap in this system, not something this feature
  introduces, and the spec puts retention and purge out of scope.
- **`source_channel_id` may outlive `source_message_id` in storage.** Invisible to every
  reader by contract 3. A future simplification could collapse the origin to
  `source_message_id` alone and derive the channel by joining the message, which would need
  no second foreign key at all — recorded in research R3 as the right shape, and out of
  scope here because the spec excludes changing the conversion and chip surfaces.
- **`ON UPDATE SET NULL` is not linted.** Identical defect, unreachable: the referenced keys
  are UUID v7 primary keys and nothing updates them. Left out deliberately, matching FR-007.
