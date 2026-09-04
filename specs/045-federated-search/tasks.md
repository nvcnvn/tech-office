# Tasks: Server-Side Federated Search

**Input**: Design documents from `/specs/045-federated-search/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **Included.** Constitution principle II makes the behavioural scenarios in
[contracts/test-scenarios.md](contracts/test-scenarios.md) planning artifacts that are
approved before implementation, so every story below has its test tasks written first.

**Organization**: Tasks are grouped by user story so each can be implemented and tested
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names the exact file it touches

## Path Conventions

Multi-tenant Go Connect-RPC backend under `backend/`, pnpm monorepo under `frontend/`
(`apps/web`, `apps/mobile`, `packages/`), living behaviour docs under `docs/domain/`.

---

## Corrections to plan.md file paths

The plan's Project Structure names two files that do not hold the code it describes. Tasks
below use the real locations:

- `SearchDocuments` (logic interface and implementation) lives in
  `backend/internal/docs/logic.go`, **not** `version_logic.go`. `CheckAccess` — the
  precedence the new predicate must mirror — is the one in `version_logic.go`.
- The collaboration logic interface to extend is `type Logic` in
  `backend/internal/collaboration/logic.go`; the implementation goes in
  `backend/internal/collaboration/task_logic.go` as planned.

[ASSUMPTION: these are transcription slips in the plan, not a design change — the described
behaviour is unchanged, only the file that holds it. Recorded here rather than editing
plan.md so the plan stays the artifact that was reviewed.]

---

## Phase 1: Setup (Contract and Schema)

**Purpose**: Land the wire contract and the schema change, and generate from both, so every
later task compiles against real types.

- [ ] T001 Create `backend/rpc/v1/search.proto` with the exact contents of `specs/045-federated-search/contracts/search.proto` (SearchService, SearchKind, SourceStatus, SearchRequest, SearchResponse, SearchHit, SearchTarget, SourceOutcome), keeping the authorization and failure comments verbatim
- [ ] T002 Generate Go and TypeScript stubs by running `buf generate` from `backend/`, producing `backend/rpc/v1/search.pb.go`, the Connect handler under `backend/rpc/v1/rpcv1connect/`, and the `packages/rpc` TypeScript client
- [ ] T003 [P] Create `backend/database/migrations/20260905000001_search_indexes.up.sql` creating `idx_event_pgroonga ON calendar.event USING pgroonga (title, description)` and `idx_file_metadata_filename_pgroonga ON files.file_metadata USING pgroonga (original_filename)` with the `COMMENT ON INDEX` text from `contracts/search.query.sql`, plus `backend/database/migrations/20260905000001_search_indexes.down.sql` dropping both
- [ ] T004 Apply the migration and regenerate the generated snapshot `backend/database/scripts/schema.sql` with `backend/scripts/regen-schema.sh` — never hand-edit that file

**Checkpoint**: `search.proto` types exist in Go and TypeScript; both new indexes exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The fan-out engine, its wiring, the frontend wrapper and the shared test
fixture. Nothing story-specific, but every story depends on all of it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Create `backend/internal/search/logic.go` with the `SearchLogic` interface, the tuning constants (`perSourceCapMixed = 5`, mixed limit default 40 / max 80, narrowed default 20 / max 50, `perSourceDeadline = 800 * time.Millisecond`, `overallBudget = 900 * time.Millisecond`), and the pure merge function sorting ascending by `(rank_within_source, source_priority, kind, id)` with source priority `person, channel, document, work_item, event, file, department, message` per [data-model.md §4](data-model.md)
- [ ] T006 Create `backend/internal/search/sources.go` with the eight-entry source descriptor table — kind, fixed priority, required permission id (`org.searchEmployees`, `org.searchDepartments`, `chat.search` for both channel and message, `docs.view`, `files.search`, `collab.viewTask`, none for event) — and the common adapter function signature that turns one domain's rows into `[]*rpcv1.SearchHit`, per [research.md R10](research.md)
- [ ] T007 Create `backend/internal/search/connect.go` with `SearchServiceServer`: trim the query, return `connect.CodeInvalidArgument` below 2 characters and truncate above 200, clamp `limit` rather than reject it, hand `s.TenantPool` (not a transaction — see plan Complexity Tracking) to the fan-out, and emit one `slog.InfoContext` per search carrying per-source status and duration
- [ ] T008 Register `SearchService` in `backend/cmd/server.go`, constructing `internal/search` with the six domain logic interfaces (`organization.Logic`, `chat.Logic`, `docs.Logic`, `files.SearchLogic`, `collaboration.Logic`, `calendar.Logic`) — `internal/search` gets no `Queries` field and no `.query.sql` file (Constitution IV)
- [ ] T009 [P] Rewrite `frontend/packages/apis/src/types/search.ts` with native `SearchHit`, `SearchTarget`, `SourceOutcome`, `SearchKind` and `SourceStatus` types, deleting `FederatedSearchResults`
- [ ] T010 Rewrite `frontend/packages/apis/src/search.ts` as a single `search({ query, kindFilter, limit })` wrapper over `SearchService.Search` returning native types with enum→string-union conversion done in the wrapper, and delete `searchAll` outright (no compatibility shim — all clients release together)
- [ ] T011 [P] Create `backend/integration/federated_search_test.go` with the `TestFederatedSearch` `testWorld` fixture: the three employees and eighteen fixture rows from [contracts/test-scenarios.md](contracts/test-scenarios.md) built once, keyed on the distinctive word `zarquon`, plus the nested `t.Run` skeleton for all four stories with `// FR-XXX` traceability comments

**Checkpoint**: `SearchService.Search` is reachable and returns an empty ranked list; the
frontend wrapper compiles; the fixture builds.

---

## Phase 3: User Story 1 - Find The Thing By Typing Its Name (Priority: P1) 🎯 MVP

**Goal**: One request over all eight sources returns a ranked list in which a document, a
file, a work item and a calendar event appear alongside people, departments, channels and
messages, and every row opens on both platforms.

**Independent Test**: In a workspace holding a document, a file, a task and an event whose
titles share a distinctive word, search that word on web and on mobile and confirm all four
appear alongside the existing four kinds, in the same order on both platforms.

### Tests for User Story 1 ⚠️

- [ ] T012 [P] [US1] Write the US1 backend scenarios in `backend/integration/federated_search_test.go`: a Document/Work item/Event/File hit each come back for the owner's query, Person/Department/Channel/Message hits come back alongside them, every hit carries title + context line + target, the Document hit carries a slug not only an id, the Work item hit carries both project id and task id, and two identical requests return an identical order (FR-001, FR-002, FR-003, FR-013)
- [ ] T013 [P] [US1] Write `frontend/apps/web/e2e/federated-search.spec.ts` with the row-rendering and navigation scenarios: Document, File, Work item and Event rows appear alongside the existing four; clicking a Document row opens the document; clicking a Work item row opens its project-scoped task route; the workspace search box remains the only entry point (FR-018, FR-020)

### Implementation for User Story 1

- [ ] T014 [US1] Add the new `-- name: SearchTasks :many` query to `backend/database/scripts/collaboration.query.sql` exactly as written in `contracts/search.query.sql` — cross-project title match on `t.title &@~ @query`, joining `collaboration.project` and `collaboration.project_state`, excluding `t.is_deleted` and `p.is_archived`, gated by `p.visibility = 'public' OR EXISTS(project_membership)`, returning `t.task_kind`, ordered by relevance then `updated_at` then `id`, with `sqlc.narg('cursor')::uuid` — then run `sqlc generate` from `backend/`
- [ ] T015 [US1] Add `SearchTasks(ctx, tx, orgID, employeeID, query, limit, cursor)` to `type Logic` in `backend/internal/collaboration/logic.go` and implement it in `backend/internal/collaboration/task_logic.go` over the generated `Queries.SearchTasks`
- [ ] T016 [P] [US1] Implement the person and department adapters in `backend/internal/search/sources.go` over `organization.Logic.SearchEmployees` / `SearchDepartments`, with `context_line` set to the person's email and to `{n} members` respectively, and targets `employee_id` / `department_id`
- [ ] T017 [P] [US1] Implement the channel and message adapters in `backend/internal/search/sources.go` over `chat.Logic.SearchChannels` / `SearchMessages`, with `context_line` `Private channel`/`Channel` and `in #{channel_name}`, and targets `channel_id` and `channel_id` + `message_id`
- [ ] T018 [P] [US1] Implement the document adapter in `backend/internal/search/sources.go` over `docs.Logic.SearchDocuments`, setting `context_line` to `Document`, carrying the **slug** in `SearchTarget.document_slug` (an id-only target pushes `/docs/undefined`), and passing the source's snippet through
- [ ] T019 [P] [US1] Implement the file adapter in `backend/internal/search/sources.go` over `files.SearchLogic.SearchFiles`, with `context_line` set to the upload context display name and target `file_id`
- [ ] T020 [P] [US1] Implement the work item adapter in `backend/internal/search/sources.go` over the new `collaboration.Logic.SearchTasks`, with `context_line` `{project_name} · Task` or `{project_name} · Ritual` derived from `task_kind`, and both `project_id` and `task_id` on the target
- [ ] T021 [P] [US1] Implement the event adapter in `backend/internal/search/sources.go` over `calendar.Logic.SearchEvents`, with `context_line` set to the formatted start date and target `event_id`
- [ ] T022 [US1] Wire the eight adapters into the concurrent fan-out in `backend/internal/search/logic.go`: one goroutine per source against the pool, per-source cap applied before merge, then the deterministic merge from T005 (depends on T016–T021)
- [ ] T023 [P] [US1] Create `DocumentSearchResult.tsx`, `FileSearchResult.tsx`, `WorkItemSearchResult.tsx` and `EventSearchResult.tsx` in `frontend/apps/web/src/app/workspace/search/components/`, each with a kind badge, title, context line, a `data-testid`, theme colours only, and the route from [research.md R11](research.md)
- [ ] T024 [US1] Rework `frontend/apps/web/src/app/workspace/search/components/SearchResults.tsx` to render the one server-ranked list in order, switching on `hit.kind` across all eight row components, and delete `frontend/apps/web/src/app/workspace/search/components/FilesTab.tsx` (files are hits like any other kind now)
- [ ] T025 [US1] Rework `frontend/apps/web/src/app/workspace/search/page.tsx` to issue exactly one `search()` request instead of the deleted client-side fan-out, passing the query through and rendering `SearchResults`
- [ ] T026 [P] [US1] Create `frontend/apps/mobile/src/app/(app)/(more)/files/[fileId].tsx` — a `GetFileMetadata`-backed detail screen showing filename, size, upload context and validation status with a Download/Share action reusing the `getDownloadUrl` → `expo-sharing` flow from the files list, so a File row has somewhere to go (FR-017, R12)
- [ ] T027 [US1] Extend `frontend/apps/mobile/src/app/(app)/(more)/search.tsx` to call `search()` once and render all eight row kinds with `testID`s, routing each per [research.md R11](research.md): Document → `/(app)/(more)/docs/{slug}`, File → `/(app)/(more)/files/{fileId}`, Work item → `/(app)/(tasks)/{projectId}/task/{taskId}`, Event → `/(app)/(calendar)/{eventId}`, Person → DM via `CreateOrGetDirectMessage`, Department → informational
- [ ] T028 [US1] Widen the MMKV recent-items record in `frontend/apps/mobile/src/app/(app)/(more)/search.tsx` to all eight kinds, keep clear-recents working, and make a recent whose target fails to open report "this item is no longer available" and remove itself from the list (FR-021, FR-022, R13)
- [ ] T029 [US1] Create `frontend/apps/mobile/.maestro/federated-search.yaml`: open app → tap the search pill → type the distinctive word → see Document, Work item, Event and File rows → tap the Document row → the document opens → back → it is offered as a recent item

**Checkpoint**: US1 is fully functional and testable — all eight kinds are found, ranked
identically on both platforms, and every row opens.

---

## Phase 4: User Story 2 - Nothing In The List Is A Door I Cannot Open (Priority: P1)

**Goal**: Document search and event search stop being over-broad, at the source rather than
behind a wrapper, so no returned row is something the caller may not open and no withheld
row is disclosed by a count.

**Independent Test**: Create a private document, a private-project task, a channel file and
a private event all containing the same distinctive word. Search it as somebody with access
to none of them and expect zero results; search as the owner of each and expect four.

> Both stories are P1 and the spec states US2 "ships with story 1 or not at all". T031–T034
> change `SearchDocuments` and `SearchEvents` signatures, so the T018 and T021 adapters gain
> an `employeeID` argument here — a one-line change each, intentionally sequenced this way
> so US1 stays independently demonstrable.

### Tests for User Story 2 ⚠️

- [ ] T030 [P] [US2] Write the US2 access scenarios in `backend/integration/federated_search_test.go`: outsider gets no Document hit and no snippet for a private document; a public document carrying an explicit `access_level = 'none'` employee grant is withheld from that member (precedence); a public document with no grant against the member is returned; an owner finds their own private document; outsider gets no Work item hit for a private-project task and no count discloses it; a member finds a public-project task; nobody finds an archived project's task; a member gets no Event hit for a private event they neither organise nor attend; the organiser does; an attendee finds a `personal_shared` event; nobody finds a cancelled event; outsider gets no File hit for a channel file, a channel member does; and the four existing sources return the same sets through federated search as through their own RPCs (FR-007 – FR-011)
- [ ] T031 [P] [US2] Write the SC-002/SC-003 sweep in `backend/integration/federated_search_test.go`: for every hit returned to every fixture caller, fetching its target by its identifiers succeeds — no row in any list refuses on open

### Implementation for User Story 2

- [ ] T032 [US2] Add the `@employee_id` parameter and the precedence-preserving access predicate to `-- name: SearchDocuments :many` in `backend/database/scripts/docs.query.sql`, exactly as in `contracts/search.query.sql` — owner, then `COALESCE` over the explicit employee grant (including `'none'`, which denies and stops the chain), then the highest department grant, then `visibility = 'public'` — written as scalar sub-selects, never as an `OR`-chain, then run `sqlc generate`
- [ ] T033 [US2] Change `SearchDocuments` in `backend/internal/docs/logic.go` to take `employeeID` and pass it through, and update its caller in `backend/internal/docs/connect.go` to source the id from the auth context — `DocumentService.SearchDocuments` gets the same fix, so the feature-043 procedure chooser stops offering unopenable documents (R6)
- [ ] T034 [US2] Change `-- name: SearchEvents :many` in `backend/database/scripts/calendar.query.sql` to take `@employee_id`, add the `organizer OR attendee OR visibility IN ('team','org_wide')` predicate byte-for-byte as `ListEventsForOrg` ships it, and replace `to_tsvector('simple', …) @@ websearch_to_tsquery` with PGroonga `&@~` on title and description ordered by `pgroonga_score`, then run `sqlc generate`
- [ ] T035 [US2] Add `employeeID` to `SearchEventsParams` / `SearchEvents` in `backend/internal/calendar/logic.go` and `backend/internal/calendar/event_logic.go` and update the caller in `backend/internal/calendar/connect.go` to pass the authenticated employee
- [ ] T036 [US2] Update the document and event adapters in `backend/internal/search/sources.go` to pass the caller's employee id, and assert in the adapter that `snippet` is left empty for any kind whose content the caller may not read (FR-007)
- [ ] T037 [US2] Confirm `SourceOutcome.hit_count` in `backend/internal/search/logic.go` counts only returned, post-cap rows — never a pre-filter total — so no count discloses the existence of withheld work (FR-009)

**Checkpoint**: US1 and US2 both hold — every row in every list is openable, and nothing
unopenable is named, snippeted or counted.

---

## Phase 5: User Story 3 - The Search Box Does Not Half-Fail In Silence (Priority: P2)

**Goal**: A failing, slow or unpermitted source costs the caller that source only, and is
named rather than silently missing.

**Independent Test**: Make one source fail, search a word matching in several sources, and
confirm every other source's results are shown together with a visible note naming the kind
that could not be reached.

### Tests for User Story 3 ⚠️

- [ ] T038 [P] [US3] Write the US3 scenarios in `backend/integration/federated_search_test.go`: all eight outcomes are `OK` when healthy; a failing source yields `UNAVAILABLE` with a non-empty detail while the other seven stay `OK` and still return hits; a source past its deadline does not delay the response beyond the overall budget; all sources failing returns `connect.CodeUnavailable` rather than an empty success; a source with no matches is `OK` with `hit_count` zero, not `UNAVAILABLE`; a caller without `docs.view` gets a successful search with the document outcome `NOT_PERMITTED` and every other source answering; a caller permitted nothing gets a successful empty response with eight `NOT_PERMITTED` outcomes (FR-004, FR-005, FR-006, FR-012, R14)
- [ ] T039 [P] [US3] Add the partial-failure scenario to `frontend/apps/web/e2e/federated-search.spec.ts`: when one source fails the page still lists the healthy sources' results and names the unavailable kind

### Implementation for User Story 3

- [ ] T040 [US3] Give each source goroutine its own `context.WithTimeout(perSourceDeadline)` in `backend/internal/search/logic.go`, recover from a panicking adapter, and record a `SourceOutcome` per source — `OK` with a post-cap `hit_count`, or `UNAVAILABLE` with a short non-sensitive `detail` such as `"timed out"` — always emitting all eight entries in the fixed source order
- [ ] T041 [US3] In `backend/internal/search/connect.go`, read `interceptor.UserPermissionsFromContext`, skip any source whose permission the caller lacks, and report it `NOT_PERMITTED` with detail `"missing permission {id}"` without querying it; events are never `NOT_PERMITTED` because calendar search is any-authenticated today (R10)
- [ ] T042 [US3] In `backend/internal/search/connect.go`, return `connect.CodeUnavailable` when no source returned `OK` **and at least one was attempted**, and return a normal empty success when every source was `NOT_PERMITTED` — nothing is broken, it is just not theirs (R14)
- [ ] T043 [US3] Add one `slog.WarnContext` per failed source in `backend/internal/search/logic.go` carrying the source kind, the failure reason and the elapsed duration, alongside the per-search `InfoContext` from T007
- [ ] T044 [P] [US3] Render the outcome banner in `frontend/apps/web/src/app/workspace/search/page.tsx`: name each kind whose outcome is `UNAVAILABLE`, stay silent for `NOT_PERMITTED`, and show an error rather than "no results" when the call itself fails
- [ ] T045 [US3] Render the equivalent inline note in `frontend/apps/mobile/src/app/(app)/(more)/search.tsx` for `UNAVAILABLE` sources, and show "the search could not run" rather than an empty or stale list when the request fails offline (spec edge case)

**Checkpoint**: An incomplete answer is legible on both platforms; a permission gap is a
skip, not an error.

---

## Phase 6: User Story 4 - Narrow To One Kind (Priority: P3)

**Goal**: A caller can ask for one kind only and get a deeper list of it than the mixed
list contained.

**Independent Test**: Search a word matching many results across kinds, narrow to one kind,
and confirm only that kind is listed and more of it appears than in the mixed view.

### Tests for User Story 4 ⚠️

- [ ] T046 [P] [US4] Write the US4 scenarios in `backend/integration/federated_search_test.go`: with no kind filter no source exceeds the per-source cap, one matching document appears within the first eight hits against a hundred matching messages, and the total never exceeds the maximum; narrowed to documents every hit is a Document hit and more documents come back than the mixed list held; an over-large narrowed limit is clamped to the narrowed maximum (FR-014, FR-015, FR-016, SC-006)
- [ ] T047 [P] [US4] Add the narrowing scenarios to `frontend/apps/web/e2e/federated-search.spec.ts`: a category tab per kind with a result count, clicking one narrows the list, and changing the query keeps the narrowing (FR-018, US4 AC2)

### Implementation for User Story 4

- [ ] T048 [US4] Honour `kind_filter` in `backend/internal/search/logic.go`: query only the named source, skip the per-source cap, and apply the narrowed default 20 / max 50 limits instead of the mixed 40 / 80
- [ ] T049 [US4] Rework `frontend/apps/web/src/app/workspace/search/components/CategoryTabs.tsx` to an "All" tab plus one tab per `SearchKind`, each labelled with its `SourceOutcome.hit_count`
- [ ] T050 [US4] Wire tab selection in `frontend/apps/web/src/app/workspace/search/page.tsx` to re-issue `search()` with `kindFilter`, keeping the selected kind in the URL so it survives a query change

**Checkpoint**: All four stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Living documentation (Constitution XII), the drift register, and the full
verification runs from [quickstart.md](quickstart.md).

- [ ] T051 [P] Rewrite the federated-search section of `docs/domain/workspace-navigation.md` to describe the server-side `SearchService.Search` behaviour — eight sources, per-source access rules, ranking, capping and `SourceOutcome` — and **delete** the client-side four-source fan-out description rather than annotating it (FR-023)
- [ ] T052 [P] Update `docs/domain/docs-knowledge.md`: document search is access-scoped for every caller now, with the owner → employee-grant → department-grant → visibility precedence stated; delete the superseded org-scoped description
- [ ] T053 [P] Update `docs/domain/calendar.md`: event search honours `organizer / attendee / team / org_wide` visibility and matches with PGroonga; delete the superseded description
- [ ] T054 [P] Update `docs/domain/rituals-tasks.md`: work items — ordinary tasks and ritual instances alike — are searchable across projects, scoped to projects the caller may read
- [ ] T055 Update the drift register in `docs/domain/README.md`: remove **D5** entirely (FR-023) and narrow **D49** to the organization-scoped document *tree* listings alone (FR-024)
- [ ] T056 Grep the repository for any remaining description of the search box as a client-side fan-out over four sources — including `backend/docs/SYSTEM-ARCHITECTURE.md` — and correct or delete it (SC-009)
- [ ] T057 Run `make lint-tenancy` and confirm it passes; this feature touches four schemas' queries and every one must still pin `organization_id`
- [ ] T058 Run `make test-backend` end to end and fix every failure — `SearchDocuments` and `SearchEvents` now return less than they used to, so an existing scenario that depended on the org-scoped behaviour is a real regression to look at, not noise to silence
- [ ] T059 Run `make test-frontend` end to end and confirm zero failures and no `test.skip` left from this feature
- [ ] T060 Run `make test-mobile` end to end and confirm the new Maestro flow passes
- [ ] T061 Verify the mobile search screen by eye at **360 dp on Android and on iOS** with all eight row kinds present, nothing clipped or overlapping, and each row navigating to its target (SC-010, Principle XIII — the habitual test device is an iPhone SE, so narrow-Android regressions otherwise go unnoticed)
- [ ] T062 Measure p95 latency against a seeded workspace using the `curl` loop in [quickstart.md](quickstart.md), confirm it is under 1 s, and check with `EXPLAIN ANALYZE` that `idx_event_pgroonga` and `idx_file_metadata_filename_pgroonga` are being used (SC-004)
- [ ] T063 Verify SC-008 manually: create a document titled `Quy trình đóng cửa`, search `đóng cửa` on both platforms, and confirm it comes back the same way an English title does

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately. T002 depends on T001; T004 depends on T003.
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks all user stories**. T005–T008 are sequential within `internal/search`; T009 → T010; T011 is independent.
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on Phase 2; touches the T018/T021 adapters from US1, so run after US1 if implementing sequentially. Both are P1 and **ship together** — the spec states US2 "ships with story 1 or not at all", so US1 alone is not releasable.
- **US3 (Phase 5)**: depends on Phase 2 and on the fan-out from T022; independent of US2.
- **US4 (Phase 6)**: depends on Phase 2 and on T022; independent of US2 and US3.
- **Polish (Phase 7)**: depends on all stories being complete.

### Within Each User Story

- Tests are written before the implementation they cover and must fail first.
- SQL → `sqlc generate` → logic layer → adapter → connect layer → clients.
- The eight adapters (T016–T021) are independent of each other but all block the fan-out wiring (T022).

### Parallel Opportunities

- **Phase 1**: T003 runs alongside T001/T002.
- **Phase 2**: T009 and T011 run alongside T005–T008.
- **US1**: T012 and T013 in parallel; then T016–T021 (six adapters, six independent sections of `sources.go` — coordinate the file or split by kind) in parallel; T023 and T026 in parallel with the backend work.
- **US2**: T030 and T031 in parallel; T032/T033 (docs) and T034/T035 (calendar) are two independent tracks.
- **US3**: T038 and T039 in parallel; T044 and T045 in parallel once T040–T042 land.
- **US4**: T046 and T047 in parallel.
- **Polish**: T051–T054 are four different documents and run fully in parallel.

### Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "US1 backend scenarios in backend/integration/federated_search_test.go"
Task: "US1 row rendering and navigation in frontend/apps/web/e2e/federated-search.spec.ts"

# Then the six source adapters together:
Task: "person + department adapters in backend/internal/search/sources.go"
Task: "channel + message adapters in backend/internal/search/sources.go"
Task: "document adapter in backend/internal/search/sources.go"
Task: "file adapter in backend/internal/search/sources.go"
Task: "work item adapter in backend/internal/search/sources.go"
Task: "event adapter in backend/internal/search/sources.go"

# And the client surfaces alongside them:
Task: "four new result components in frontend/apps/web/src/app/workspace/search/components/"
Task: "mobile file detail screen frontend/apps/mobile/src/app/(app)/(more)/files/[fileId].tsx"
```

---

## Implementation Strategy

### MVP scope

**Phases 1–4 (T001–T037).** US1 alone is *demonstrable* but not *shippable*: wiring
documents and events into a prominent search box while they still return every document in
the organization and ignore event visibility turns a latent disclosure into a daily one.
The spec makes this explicit — US2 "ships with story 1 or not at all" — so the MVP is US1
**and** US2 together.

### Incremental delivery

1. Phases 1–2 → the RPC exists and returns an empty ranked list.
2. Phase 3 (US1) → all eight kinds are findable and openable. Demo internally, do not release.
3. Phase 4 (US2) → every row is a door the caller can open. **Releasable.**
4. Phase 5 (US3) → a partial answer is legible instead of silently short.
5. Phase 6 (US4) → narrowing to one kind.
6. Phase 7 → documentation, drift register, full suites and manual verification.

### Parallel team strategy

Once Phase 2 is done: one developer takes US1's backend (T014–T022), one takes US1's
clients (T023–T029), one takes US2's two independent query tracks. US3 and US4 join after
T022 lands.

---

## Notes

- `internal/search` owns **zero SQL** and holds no `Queries` field — it depends on six
  domains' logic interfaces (Constitution IV).
- The connect layer passes the **pool**, not a transaction: a `pgx.Tx` is not safe for
  concurrent use and the fan-out is concurrent by design (plan Complexity Tracking).
- `backend/database/scripts/schema.sql` is generated from the migrations and is never
  hand-edited; neither is any `sqlc`- or `buf`-generated file.
- No compatibility shim: `searchAll` and `FederatedSearchResults` are deleted outright and
  all three clients release together.
- Commit after each task or logical group; stop at any checkpoint to validate a story.
