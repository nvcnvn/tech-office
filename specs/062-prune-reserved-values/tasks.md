---

description: "Task list for 062 — Prune Reserved-But-Unused Values"
---

# Tasks: Prune Reserved-But-Unused Values

**Input**: Design documents from `/specs/062-prune-reserved-values/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Test tasks are included. The specification requires them — FR-012 (no reduction
in coverage), FR-013 (the notification alignment check must keep holding), and Constitution
principle II (scenario-first integration and E2E testing). They are not optional here.

**Organization**: Grouped by user story so each can be implemented and verified
independently. Priority order from spec.md is US1 (P1), US3 (P1), US2 (P2), US4 (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 or US4 — maps to the user story in spec.md
- Paths are relative to the repository root `/Volumes/T5/Codes/tech-office`

## Path Conventions

Monorepo: `backend/` (Go), `frontend/packages/*` (shared TypeScript wrappers),
`frontend/apps/web` (Next.js), `frontend/apps/mobile` (Expo Router), `docs/domain/`
(living behaviour snapshots).

[ASSUMPTION: quickstart.md names `make dev-db`, which does not exist in the Makefile. The
target that brings up the local Postgres and supporting infrastructure is `make infra-up`,
so that is what these tasks use. quickstart.md is corrected in T049.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get a working tree that can run all three suites, and record the baseline so
FR-012's "no reduction in coverage" is measured rather than asserted.

- [X] T001 Bring up local Postgres and supporting infrastructure with `make infra-up` from the repository root, then confirm `make check-postgres` passes
- [X] T002 Install and build the frontend workspace: `cd frontend && pnpm install && pnpm --filter "./packages/*" run build` — the `dst/` build is mandatory before any typecheck on a clean tree (drift D34)
- [X] T003 Record the baseline test counts to `specs/062-prune-reserved-values/baseline.txt` by running `make test-backend`, `make test-frontend` and `cd frontend && pnpm run typecheck:mobile`, capturing pass/fail counts per suite so SC-006 can be evaluated against a number rather than an impression

**Checkpoint**: All three suites run and their pre-change state is written down.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single forward-only migration and the generated database artifacts that
derive from it. This is one file touching five value sets, so it cannot be split across
story phases without same-file conflict.

**⚠️ CRITICAL**: US1 and US3 cannot be completed until this phase is done. US2 and US4
touch no database state and may proceed in parallel with this phase.

- [X] T004 Create `backend/database/migrations/20260912000003_prune_reserved_values.up.sql` with the audit section only: one `DO $$ ... RAISE EXCEPTION` block per removed value that counts offending rows and aborts with a message naming the table, the value and the count — covering `chat.channel.channel_type IN ('crm_deal_notes','support_ticket')`, `files.file_access_rule.context_type IN ('support_ticket','crm_deal')`, `iam.credential.credential_type = 'biometric'`, and `notification.notification.source_domain IN ('crm','hr','support','finance')` per [contracts/migration.md](contracts/migration.md#audit-dispositions)
- [X] T005 Append the `muted_domains` repair to `backend/database/migrations/20260912000003_prune_reserved_values.up.sql` — the array-subtraction `UPDATE` from [contracts/database-constraints.md](contracts/database-constraints.md#data-repair--muted_domains), guarded by the `&&` predicate so untouched rows are not rewritten. It MUST appear before any CHECK is tightened (FR-010)
- [X] T006 Append the five drop-and-add CHECK constraint statements to `backend/database/migrations/20260912000003_prune_reserved_values.up.sql` — `valid_channel_type` (3 values), `file_access_rule_context_type_check` (4), `credential_credential_type_check` (`= 'pin'`), `notification_source_domain_valid` (5), `muted_domains_valid` (subset of 5)
- [X] T007 Append the six `COMMENT ON` corrections to `backend/database/migrations/20260912000003_prune_reserved_values.up.sql` per [contracts/database-constraints.md](contracts/database-constraints.md#column-comments), including rewriting the `files.file_access_rule.context_type` comment's opening phrase from "Upload context type" to "Access-rule context type"
- [X] T008 Append the thirteen `DROP SCHEMA <name> RESTRICT;` statements to `backend/database/migrations/20260912000003_prune_reserved_values.up.sql` as the final section — `assets`, `communication`, `crm`, `finance`, `hiring`, `integrations`, `inventory`, `learning`, `payroll`, `procurement`, `retention`, `support`, `timekeeping`. `CASCADE` is forbidden; `compliance` is NOT in the list
- [X] T009 Apply the migration with `cd backend && go run ./cmd migrate`, then regenerate the derived artifacts: `./scripts/regen-schema.sh` (rewrites `backend/database/scripts/schema.sql`) and `sqlc generate` (rewrites `backend/database/models.go` and `*.query.sql.go`). Neither generated file may be hand-edited

**Checkpoint**: Database constraints are narrowed, thirteen schemas are gone, generated Go
database code matches. US1 and US3 can now begin.

---

## Phase 3: User Story 1 - A person configuring notifications sees only real categories (Priority: P1) 🎯 MVP

**Goal**: The notification mute list offers exactly the five categories the workspace can
publish into — chat, projects, calendar, docs, system — and a person's saved mutes for the
four removed categories drop away without breaking their preferences.

**Independent Test**: Open More → Settings → notification mutes in the mobile app, confirm
exactly five rows, toggle one, and confirm a notification the workspace genuinely sends in
that category is suppressed. Reopen preferences for a person who had muted a removed
category and confirm the screen loads with their surviving mutes intact.

[ASSUMPTION: US1's acceptance mentions "on mobile and on web", but per
[research.md](research.md#14-notification-source-domains--crm-hr-support-finance) there is
no web mute list — `SOURCE_DOMAINS` has exactly one app consumer. The web leg is satisfied
vacuously; building a web mute screen is a feature, not a prune, and FR-011 forbids it.]

### Tests for User Story 1

- [X] T010 [US1] Run `cd backend && go test ./integration -run 'TestNotificationPersonalPreference' -v` and confirm the "every source domain the system publishes from can be muted" scenario in `backend/integration/notification_personal_preference_test.go` now iterates five domains and stays green — FR-013. This test needs no edit; if it requires one, the reduction was done wrong

### Implementation for User Story 1

- [X] T011 [US1] Delete the four `SourceDomain*` constants (`crm`, `hr`, `support`, `finance`) and their four `allSourceDomains` entries in `backend/internal/notification/constants.go`, and correct the file's own comment that names the layers which must agree
- [X] T012 [US1] Correct every trailing comment in `backend/rpc/v1/notification.proto` that enumerates the source domains — the `source_domain` field comment, the `ListNotifications` filter field, and the "Values are from the same set the publisher accepts" comment near line 615 — to read `chat, projects, docs, calendar, system`. `source_domain` is a `string`, so no field or enum changes
- [X] T013 [US1] Verify `backend/internal/chat` still compiles: it re-exports `internal/notification` source-domain constants through the existing interface, and four of them have just disappeared from both sides. Run `cd backend && go build ./...` and remove any re-export of a deleted constant
- [X] T014 [P] [US1] Narrow the `SourceDomain` union and the `SOURCE_DOMAINS` array in `frontend/packages/apis/src/notification.ts` to `chat`, `projects`, `calendar`, `docs`, `system` in that order, keeping the doc comment that explains the deliberate reading order and its D28 history
- [X] T015 [US1] Delete the four surplus `MUTE_ROWS` keys (`crm`, `hr`, `support`, `finance`) in `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`. `Record<SourceDomain, …>` makes them a type error once T014 lands; the screen renders from `SOURCE_DOMAINS.map(...)` so no rendering code changes
- [X] T016 [US1] Run `cd frontend && pnpm --filter "./packages/*" run build && pnpm run typecheck:mobile` and confirm zero diagnostics — this is the repository's one CI-enforced gate
- [X] T017 [US1] Update `docs/domain/notifications-presence.md` to describe five source domains and a five-row mute list, deleting the four removed categories rather than annotating them (FR-014)

**Checkpoint**: The mute list is five real categories on every layer that declares it, and
the cross-layer alignment guard that caught drift D28 still holds.

---

## Phase 4: User Story 3 - A contributor reads the system and finds no inert values (Priority: P1)

**Goal**: The permitted-value sets for channel kinds, file-attachment contexts and sign-in
credentials contain only values the workspace produces, and no named storage area is empty.

**Independent Test**: Read each CHECK constraint, Go constant set, proto enum and TypeScript
union for these three sets and confirm every listed value has a producer; query
`pg_namespace` for schemas with zero objects and get zero rows.

**Depends on**: Phase 2 (the migration narrows these CHECKs). Independent of US1, US2, US4.

### Tests for User Story 3

- [X] T018 [US3] Create `backend/integration/platform_schema_test.go` following the repository's `testWorld` pattern, asserting that no schema outside `pg_catalog`, `pg_toast`, `information_schema` and `public` is empty — the query is in [contracts/database-constraints.md](contracts/database-constraints.md#standing-invariant-added). This is the standing guard that makes SC-004 durable rather than a one-time count

### Implementation for User Story 3 — channel kinds

- [X] T019 [US3] Delete `CHANNEL_TYPE_CRM_DEAL_NOTES = 4` and `CHANNEL_TYPE_SUPPORT_TICKET = 5` from the `ChannelType` enum in `backend/rpc/v1/chat.proto`. Tags 0–3 keep their numbers; add no `reserved` marker — a reserved line would itself be the inert value this feature removes
- [X] T020 [P] [US3] Delete `FILE_CONTEXT_TYPE_SUPPORT_TICKET = 5` and `FILE_CONTEXT_TYPE_CRM_DEAL = 6` from the `FileContextType` enum in `backend/rpc/v1/files.proto`
- [X] T021 [US3] Regenerate protobuf output for both Go and TypeScript from `backend/buf.gen.yaml` — `backend/rpc/v1/*.pb.go`, `backend/rpc/v1/rpcv1connect/` and `frontend/packages/rpc/rpc/v1/*_pb.ts`. Generated files are committed and must never be hand-edited (depends on T012, T019, T020)
- [X] T022 [US3] Delete `ChannelTypeCRMDealNotes` and `ChannelTypeSupportTicket` and their two `IsValidChannelType` cases in `backend/internal/chat/constants.go`
- [X] T023 [US3] Delete the three switch arms naming the removed channel kinds in `backend/internal/chat/logic.go` (around lines 501, 518 and 4125) — T021 makes each a compile error, so `go build ./...` enumerates them
- [X] T024 [US3] Delete the two switch arms naming the removed channel kinds in `backend/internal/chat/connect.go` (around lines 1005 and 1155)

### Implementation for User Story 3 — file contexts and credentials

- [X] T025 [P] [US3] Delete `ContextTypeSupportTicket` and `ContextTypeCRMDeal` in `backend/internal/files/constants.go` (around lines 63–64), leaving `ValidUploadContexts()` in the same file completely untouched — it is a different set and is explicitly out of scope
- [X] T026 [US3] Delete the two switch arms naming the removed contexts in `backend/internal/files/service.go` (around lines 1421 and 1440)
- [X] T027 [P] [US3] Delete `CredentialTypeBiometric` in `backend/internal/iam/constants.go` (around line 68). The `credential_type` column and its now single-valued CHECK both stay — `idx_credential_identity_type_active` is a partial unique index over `(organization_id, identity_id, credential_type)` and rewriting it would change live behaviour (FR-011)

### Implementation for User Story 3 — frontend

- [X] T028 [US3] Narrow the `ChannelType` union to `chat | direct_message | project_ticket_thread` and delete the two `convertChannelType` case arms in `frontend/packages/apis/src/chat.ts` (around lines 75–76 and 860–863). The deleted case labels reference generated enum members that no longer exist after T021, so this edit is mandatory for the package to compile
- [X] T029 [P] [US3] Correct the stale comment listing the channel-type union in `frontend/packages/apis/src/types/search.ts` (around line 56)
- [X] T030 [P] [US3] Correct the stale comment `// "task", "crm_deal", "support_ticket"` in `frontend/packages/apis/src/chat.ts` (around line 1068)

### Documentation for User Story 3

- [X] T031 [P] [US3] Update `docs/domain/chat.md`: delete the `crm_deal_notes` and `support_ticket` rows from the channel-type table (around lines 23–24) and delete the open-question bullet about reserved channel types (around line 319) — the question is answered by this work, not merely noted (SC-007)
- [X] T032 [P] [US3] Update `docs/domain/files.md` to describe a four-value file-attachment context set, and `docs/domain/auth-identity.md` to describe `pin` as the only credential kind
- [X] T033 [P] [US3] Update `docs/domain/platform.md`: delete the "reserved but unused schemas" paragraph (around line 387) and correct its incorrect inclusion of `compliance`, which holds four objects and is retained. State the eleven surviving schemas

**Checkpoint**: Every permitted value in these three sets has a producer, the storage layout
has no empty area, and a standing test keeps it that way.

---

## Phase 5: User Story 2 - A person browsing the workspace is not shown modules that do not exist (Priority: P2)

**Goal**: Workspace navigation lists only areas a person can open, with contiguous keyboard
shortcuts `⌘1`–`⌘8`.

**Independent Test**: Sign in, open `/workspace`, confirm eight entries all of which open a
working area, and press each advertised shortcut to confirm it reaches the entry printed
next to it with no gaps or dead keys.

**Depends on**: Nothing in Phase 2. Can run fully in parallel with US1, US3 and US4.

### Tests for User Story 2

- [X] T034 [US2] Create `frontend/apps/web/e2e/workspace-navigation.spec.ts` asserting that every rendered workspace navigation entry is enabled and navigates to a real route, and that the advertised shortcuts form the contiguous run `⌘1`–`⌘8` with no dead key. Nothing in the type system catches a stray disabled entry, which is why this assertion exists (SC-003)

### Implementation for User Story 2

- [X] T035 [US2] Delete the three `enabled: false` navigation entries — CRM (`⌘9`), Finance (`⌘-`) and HR (`⌘=`) — from the nav array in `frontend/apps/web/src/app/workspace/layout.tsx` (around lines 156–178). Keep the `enabled` field on the type and on the surviving entries: it shares a rendering path with the `permission` gate that `organization` (`iam.inviteUser`) and `reviews` (`collab.reviewEvidence`) use, and collapsing it is a refactor of live navigation rather than a prune
- [X] T036 [US2] Run `make test-frontend` and confirm the new navigation assertion passes along with the existing web suite. A cold `.next` cache produces unrelated flakes (drift D54); a warm cache with `NEXT_DIST_DIR=.next-e2e` is the reliable configuration
- [X] T037 [US2] Update the navigation-entry section of `docs/domain/workspace-navigation.md` to describe eight entries with shortcuts `⌘1`–`⌘8`, deleting the three disabled entries rather than annotating them

**Checkpoint**: Every navigation entry opens something. No dead keys.

---

## Phase 6: User Story 4 - A shared link resolves by one grammar, not two (Priority: P2)

**Goal**: Only the canonical `/o/{tenantKey}/r/{resourceType}/{resourceId}` grammar
resolves; the historical hostname-derived grammar is gone, along with the
`LegacyNormalized` flag that reported on it.

**Independent Test**: Share a link from a task, a document, a chat channel and a calendar
event; open each on web and on mobile and confirm it resolves. Then open a legacy-shaped
URL such as `https://acme.example.com/chat/{channelId}` and confirm the standard
"link not recognised" outcome. Inspect a resolved payload and confirm no `legacyNormalized`
key is present.

**Depends on**: Nothing in Phase 2. Can run fully in parallel with US1, US2 and US3.

### Tests for User Story 4

- [X] T038 [US4] In `backend/integration/canonical_links_test.go`, delete the "when a legacy product link is normalized" subtest (around line 251) — per FR-012 a check that outlives its subject is a false gate — and replace it in the same file with an assertion that a legacy-shaped URL is now rejected with the standard unresolvable-link outcome. The replacement is a genuine behavioural requirement (US4 acceptance scenario 2), not a tautology about an absent code path, so the check count does not fall

### Implementation for User Story 4

- [X] T039 [US4] Delete the `LegacyNormalized` field from `NormalizeResult` in `backend/internal/linking/normalize.go` (around lines 9–14). It is removed, not defaulted to false — a boolean that can only ever be false is the defect this feature exists to remove
- [X] T040 [US4] Delete the legacy fallthrough in `backend/internal/linking/normalize.go` (around lines 45–49) so an unmatched path errors directly, and update the failure message from `unsupported canonical or legacy path` to `unsupported canonical path`. Callers match on the error rather than the string, so the RPC-level response a client sees is unchanged (FR-011, Constitution X)
- [X] T041 [US4] Delete the whole `normalizeLegacyRoute` function from `backend/internal/linking/normalize.go` (around lines 52–106, roughly 55 lines) together with any helper it alone uses
- [X] T042 [P] [US4] Delete the `LegacyNormalized bool \`json:"legacyNormalized,omitempty"\`` field in `backend/internal/linking/types.go` (around line 134)
- [X] T043 [US4] Delete the `LegacyNormalized` assignment in `backend/internal/linking/service.go` (around line 161)
- [X] T044 [P] [US4] Delete the optional `legacyNormalized?: boolean` property in `frontend/packages/links/src/index.ts` (around line 42)
- [X] T045 [US4] Delete the "`LegacyNormalized` flags this" clause (around line 52) and the "Legacy route normalisation is open-ended" open question (around line 804) from `docs/domain/workspace-navigation.md` — the question is answered by this work (SC-007)

**Checkpoint**: One link grammar. Canonical links resolve as before; legacy shapes get the
standard unrecognised-link outcome.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Prove the whole change set holds together across every layer (FR-008), and
that documentation says what the system says (FR-014).

- [X] T046 Run the full gate — `make test-backend`, `make test-frontend`, and `cd frontend && pnpm run typecheck:mobile` — and compare against `specs/062-prune-reserved-values/baseline.txt` from T003. SC-006 requires all green with no reduction in checks covering surviving behaviour. Two known conditions are not regressions from this change: backend load-dependence under `-parallel 8` (drift D52) and the web cold-cache compile race (drift D54)
- [X] T047 Verify cross-layer alignment by hand for all five value sets per [quickstart.md](quickstart.md) Scenario 2: query `pg_constraint` for the five CHECK definitions and cross-check each against its Go constant, proto enum and TypeScript union. No value may appear in one layer and not another — this is FR-008
- [X] T048 Run the documentation check `grep -rniE 'crm_deal_notes|support_ticket|crm_deal|biometric|legacyNormalized|normalizeLegacyRoute' docs/domain/` and confirm no hit describes current behaviour (SC-007). Confirm the three open questions are deleted rather than annotated, and that `docs/domain/README.md`'s drift register needs no row added or removed — these were consistent-but-inert values, never registered drift
- [X] T049 Correct `specs/062-prune-reserved-values/quickstart.md` to use `make infra-up` in place of the non-existent `make dev-db` target, so the validation recipe runs as written
- [X] T050 Run `make lint-tenancy` to confirm the regenerated `backend/database/scripts/schema.sql` still satisfies the multi-tenant schema discipline after the constraint and schema changes
- [X] T051 Verify the mobile settings screen by hand with `make dev-mobile` (or the repository's unified mobile dev command) on both a narrow Android viewport and iOS — the habitual test device is an iPhone SE, so narrow-Android regressions go unnoticed otherwise. Navigate to More → Settings → notification mutes and confirm exactly five rows: Chat, Tasks and projects, Calendar, Documents, System

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup. **Blocks US1 and US3 only.** US2 and US4 touch no database state and may start immediately after Setup
- **US1 (Phase 3)**: Depends on Phase 2
- **US3 (Phase 4)**: Depends on Phase 2
- **US2 (Phase 5)**: Depends on Setup only
- **US4 (Phase 6)**: Depends on Setup only
- **Polish (Phase 7)**: Depends on all four stories

### The one cross-story coupling

T021 (`buf generate`) regenerates output for edits made in both US1 (T012, comments in
`notification.proto`) and US3 (T019, T020, enum deletions). Regeneration is idempotent, so
if US1 and US3 are worked in parallel, run T021 again after the later of the two lands. It
is placed in US3 because that is where the enum deletions — the edits that force compile
errors downstream — are made.

### Within Each User Story

- Proto edits before regeneration before Go/TypeScript edits: deleting an enum value makes
  every switch arm that names it a compile error, and that is the intended mechanism for
  enforcing FR-008 rather than a nuisance
- Go constants before the mapping switches that reference them
- `packages/apis` before `apps/mobile`: `Record<SourceDomain, …>` turns the wrapper
  narrowing into a compile error in the app, per Constitution VII
- Implementation before documentation, so the document describes what the code does

### Parallel Opportunities

- **US2 and US4 can be built entirely in parallel with Phase 2 and with each other** — neither touches the database, the proto contract, or any file the other stories edit
- Within Phase 2, tasks T004–T008 all edit the same migration file and are strictly sequential
- Within US3: T019/T020 (two different `.proto` files), T025/T027 (two different Go packages), T029/T030 (two different comments), T031/T032/T033 (three different domain documents) are each parallelisable
- Within US4: T042 and T044 touch different files from the `normalize.go` chain
- All four documentation tasks across stories (T017, T031, T032, T033, T037, T045) touch different files and can be done in parallel once their implementation lands — except T037 and T045, which both edit `docs/domain/workspace-navigation.md` and must be sequenced

---

## Parallel Example: User Story 3

```bash
# Proto edits — different files:
Task: "Delete ChannelType values 4 and 5 in backend/rpc/v1/chat.proto"
Task: "Delete FileContextType values 5 and 6 in backend/rpc/v1/files.proto"

# After buf generate, Go constant deletions in three separate packages:
Task: "Delete removed ContextType consts in backend/internal/files/constants.go"
Task: "Delete CredentialTypeBiometric in backend/internal/iam/constants.go"

# Documentation — three different files:
Task: "Update docs/domain/chat.md channel-type table and open question"
Task: "Update docs/domain/files.md and docs/domain/auth-identity.md"
Task: "Update docs/domain/platform.md schema list and compliance correction"
```

## Parallel Example: whole-feature staffing

```bash
# Developer A: Phase 2 → US1 (notification categories)
# Developer B: US2 (web navigation) — no database dependency
# Developer C: US4 (shared links) — no database dependency
# Developer A or D: US3 once Phase 2 lands
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — the migration and the generated database artifacts
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: five rows on the mobile mute screen, alignment test green over
   five domains, a person's saved mutes preserved across the migration
5. This is shippable on its own — it is the only part of the prune a person can see

### Incremental Delivery

Each story is independently shippable, but the specification's own position (FR-008,
Constitution VI, and the project's standing no-backward-compatibility stance) is that the
proto break ships atomically across backend, web and mobile. So:

1. Setup + Foundational → database narrowed
2. US1 → notification categories → validate
3. US3 → channel kinds, file contexts, credentials, schemas → validate
4. US2 → web navigation → validate
5. US4 → shared links → validate
6. Polish → full gate, cross-layer alignment audit, documentation check
7. **Ship all of it as one change set.** Backend image, web build and mobile build deploy
   together; the migration runs before the new backend serves traffic. There is no window
   in which an old client talks to a new backend, which is what makes the proto break safe

### Rollback

Forward-only, matching the repository convention — there is no `.down.sql`. The realistic
rollback is redeploying the previous images, which works against the migrated database for
everything except the five narrowed CHECKs, and the old code never produces the removed
values anyway. That residual risk is accepted; the alternative is the compatibility layer
this feature exists to remove.

---

## Notes

- Net deletion in every package this touches except the one new migration and the two new
  tests. If a task makes a package larger, re-read it — the feature is a removal
- `backend/database/scripts/schema.sql`, `backend/database/models.go`, `backend/rpc/v1/*.pb.go`
  and `frontend/packages/rpc/rpc/v1/*_pb.ts` are all generated. Never hand-edit them; run
  the generator and commit the output
- `DROP SCHEMA ... CASCADE` is forbidden in T008. `RESTRICT` is both the action and the
  emptiness proof, and they cannot drift apart
- The migration aborts rather than deleting a stray row, even though the spec permits
  deletion. A row whose existence contradicts the premise of the change deserves a human's
  attention before it is destroyed
- Commit after each task or logical group; stop at any checkpoint to validate a story

---

## Implementation notes

[ASSUMPTION: T003's baseline was captured after the migration had been applied, because
the environment repair below happened first and the migration is what the repair verified.
The Go code was still at HEAD, so the comparison is a fair one for FR-012; the nine
failures it shows are each attributed individually in `baseline.txt` and none of them is a
reduction in coverage.]

[ASSUMPTION: the local `postgres` container was running outside the `tech-office-backend`
compose project (it carried `com.docker.compose.project=backend`), so `regen-schema.sh`'s
`docker compose ps` guard could not see it and `make infra-up` refused on a name conflict.
Rather than bypass the repository's tooling, the container was re-parented into the right
project: `pg_dumpall` to `/tmp`, stop, rename the old container to
`tech-office-postgres-orphan-20260912` (kept, with its anonymous volume, as a second
backup), `make infra-up`, restore. Zero errors on restore, migration state intact.]

[ASSUMPTION: T012 also corrected two comments in `internal/notification/constants.go` that
pointed at `packages/apis/src/notifications.ts`; the file is `notification.ts`. A
cross-layer alignment comment that names a file which does not exist is the same class of
defect this feature removes.]

[ASSUMPTION: the column comment for `files.file_access_rule.context_type` names the proto
enum `rpc.v1.FileContextType` rather than `packages/apis/src/files.ts`, which the contract
specified. There is no TypeScript union for this set: `packages/apis/src/files-security.ts`
re-exports the generated enum, so the layers cannot drift. Naming a file with no such type
would have been a new inert reference.]

[ASSUMPTION: T034's spec asserts the advertised shortcut *labels* form a contiguous run
rather than pressing the keys. The web app registers no meta-key handler — `shortcut` is
display copy on `TabLink` — so a keypress test would assert nothing. This is recorded in
the spec file's header comment, and in `docs/domain/workspace-navigation.md`.]

[ASSUMPTION: three subtests in `notification_personal_preference_test.go` used 'support'
and 'finance' as arbitrary sample domains and were retargeted onto 'docs'. T010's "this
test needs no edit" applies to the *alignment scenario*, which was indeed not edited and
passes over five domains. The sibling subtests were never about those two values.]

[ASSUMPTION: 18 regenerated PNGs under `frontend/apps/web/public/docs/` were reverted.
`docs-screenshots.spec.ts` rewrites them on every E2E run with freshly seeded data; they
are a by-product of running the suite, not of this change — the removed nav entries were
already filtered out of rendering by `tab.enabled &&`, so this feature changes no pixel.]

[ASSUMPTION: the Maestro flow needed two adjustments the shorter mute list forced — a
walked `scrollUntilVisible` check instead of a one-screenful assertion, and
`centerElement: true` before the taps on Calendar. Details in `baseline.txt`.]
