# Implementation Plan: Server-Side Federated Search

**Branch**: `045-federated-search` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/045-federated-search/spec.md`

## Summary

Replace the client-side four-source fan-out in `packages/apis/src/search.ts` with a single
server-side `SearchService.Search` RPC that fans out over **eight** sources in parallel,
each answering through its own domain logic layer with its own access rules, and returns
one ranked, per-source-capped list plus a per-source outcome report.

Three of the eight sources are wrong or missing today and are fixed at the source, not
wrapped:

| Source | State today | Change |
|---|---|---|
| Documents | org-scoped: every document to anyone with `docs.view` (D49) | add an access predicate to `SearchDocuments` matching `CheckAccess` exactly |
| Calendar events | ignores `visibility` entirely; unindexed `to_tsvector('simple')` | add the organiser/attendee/`team`/`org_wide` predicate already used by `ListEventsForOrg`; switch to PGroonga + index |
| Work items | no cross-project task search exists at all (`ListTasks` requires `project_id`, and its `search_query` field is not implemented in SQL) | new `SearchTasks` query, cross-project, gated by the project-access predicate already used by `ListTasksBySourceMessages` |

Files, people, departments, channels and messages already filter correctly and are reused
unchanged; files gains a missing PGroonga index on `original_filename`.

`internal/search` owns **zero SQL**. It depends on the six domains' logic-layer interfaces
(Principle IV), runs them concurrently against the tenant pool with a per-source deadline,
and merges. Both clients call the one RPC, so web and mobile see the same ordered list by
construction (FR-002, SC-007).

## Technical Context

**Language/Version**: Go 1.24 (backend, `go.work`); TypeScript 5.x (frontend monorepo, pnpm)

**Primary Dependencies**: Connect-RPC + protobuf (buf), pgx/v5 + sqlc (`sqlc-gen-go-crud`
wasm plugin), PostgreSQL 17 with PGroonga and pg_trgm; Next.js 15 + MUI v7 (web); Expo
Router + React Native (mobile); TanStack Query on both clients

**Storage**: PostgreSQL, one database, schema-per-domain (`organization`, `chat`, `docs`,
`files`, `collaboration`, `calendar`). No new tables. Three new indexes, three changed
queries, one new query.

**Testing**: `backend/integration/` (Go, `testWorld` pattern, Connect client with dev JWT);
`frontend/apps/web/e2e/` (Playwright); `frontend/apps/mobile/.maestro/` (Maestro)

**Target Platform**: Linux containers (Docker Swarm, ≥3 instances); web browsers; iOS and
Android via Expo

**Project Type**: Multi-tenant web service + web app + mobile app, released together

**Performance Goals**: p95 < 1s end-to-end as experienced by the caller (SC-004). Eight
sources run concurrently, so the floor is the slowest *single* source, not their sum.

**Constraints**: per-source deadline 800 ms, overall handler budget 900 ms; combined
response bounded at 80 hits; mixed list capped at 5 per source; mobile renders correctly at
360 dp (SC-010).

**Scale/Scope**: 1 new proto service (1 RPC), 1 new Go package, 6 logic-layer dependencies,
3 SQL query changes + 1 new query + 3 new indexes, 1 rewritten frontend API wrapper, 1 web
page + tab bar reworked, 1 mobile screen extended + 1 new mobile file-detail screen.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Result both times: PASS.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Data governance & multi-tenancy** | every query pins `organization_id`; no cross-tenant read | **PASS** — search adds no SQL of its own; every reused and new query already carries `organization_id` as its first predicate. No `AdminPool` use, so no `-- lint:cross-tenant` marker is needed. |
| **II. Scenario-first testing** | integration scenarios + E2E scenarios derived from stories/FRs, approved before tasks | **PASS** — [contracts/test-scenarios.md](contracts/test-scenarios.md) maps all 4 user stories and all 24 FRs to `t.Run` stubs in `backend/integration/federated_search_test.go` and Playwright stubs in `frontend/apps/web/e2e/federated-search.spec.ts`, with documented exclusions. |
| **III. Two-layer architecture & proto authorization** | logic/connect split; `access_control` on every RPC | **PASS with a documented deviation** — see Complexity Tracking: the connect layer passes the *pool* rather than a transaction, because a `pgx` transaction is not safe for concurrent use and the fan-out is concurrent by design. `Search` declares `allow_unauthenticated: false` with empty `required_permissions` — a deliberate "any authenticated caller" choice required by FR-012, spelled out in the proto comment. |
| **IV. Cross-domain integration** | no cross-schema SQL; depend on logic interfaces | **PASS** — `internal/search` has no `.query.sql` file and no `Queries` field. It holds six logic interfaces injected in `cmd/server.go`. Every new/changed query stays within one schema. |
| **V. Observability, simplicity & YAGNI** | `log/slog`, no premature optimisation | **PASS** — one `slog.InfoContext` per search with per-source status and duration; one `slog.WarnContext` per failed source. No search index, no cache, no new permission ids, no autocomplete change. |
| **VI. Versioning & breaking changes** | breaking changes ship atomically | **PASS** — `searchAll` and `FederatedSearchResults` are deleted outright rather than deprecated; `SearchDocuments` and `SearchEvents` narrow what they return for existing callers. All three clients release together. |
| **VII. Frontend wrapper & type safety** | apps import `apis`, never `rpc`; `data-testid`; theme colours | **PASS** — new `search()` wrapper in `packages/apis/src/search.ts` returns native types; enum → string-union conversion lives in the wrapper. New rows carry `data-testid` (web) / `testID` (mobile) and take colours from the theme. |
| **VIII. Cross-stack constants** | prefer proto enums for shared string constants | **PASS** — `SearchKind` and `SourceStatus` are proto enums, so Go and TypeScript are generated from one definition. No new string constant crosses a layer. |
| **IX. UUID v7 & nullable cursor params** | `sqlc.narg` for optional cursors | **PASS** — the new `SearchTasks` query uses `sqlc.narg('cursor')::uuid`; ids stay UUID v7 defaults. |
| **X. Structured error details** | typed error details across the stack | **PASS** — the whole point of `SourceOutcome` is that a partial answer is a *success*, not an error. The only error path is "every source failed", returned as `connect.CodeUnavailable`. |
| **XI. Distributed-first** | stateless, no in-process state | **PASS** — search is a pure read; nothing is cached or held between requests. Recent items stay in device MMKV, never on the server. |
| **XII. Living documentation** | `docs/domain/` and `backend/docs/` updated in the same change set | **PASS** — FR-023/FR-024 make this explicit: rewrite the federated-search section of `workspace-navigation.md`, update the access-control section of `docs-knowledge.md` and `calendar.md`, close D5 and narrow D49. |
| **XIII. Mobile design & testing** | employee day-to-day scope; `testID`; Maestro flow; 360 dp | **PASS** — global search is named in the principle's allowed scope. One Maestro flow covers the happy path; new rows carry `testID`; layout verified at 360 dp on Android as well as iOS. |

## Project Structure

### Documentation (this feature)

```text
specs/045-federated-search/
├── plan.md                      # This file
├── research.md                  # Phase 0 — decisions and rejected alternatives
├── data-model.md                # Phase 1 — entities, access predicates, ranking rule
├── quickstart.md                # Phase 1 — how to run and validate the feature
├── contracts/
│   ├── search.proto             # the new service contract
│   ├── search.query.sql         # new and changed SQL, exactly as it will land
│   └── test-scenarios.md        # Principle II behavioural contract
├── checklists/
│   └── requirements.md          # already written by /speckit-specify
└── tasks.md                     # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── search.proto                          # NEW — SearchService, one RPC
├── internal/
│   ├── search/                               # NEW — owns no SQL
│   │   ├── logic.go                          # SearchLogic interface + fan-out, ranking, capping
│   │   ├── sources.go                        # one adapter per source: domain rows → SearchHit
│   │   └── connect.go                        # SearchServiceServer; permission gating; pool handoff
│   ├── docs/version_logic.go                 # CHANGED — SearchDocuments takes employeeID
│   ├── calendar/event_logic.go               # CHANGED — SearchEvents takes the visibility predicate
│   └── collaboration/task_logic.go           # CHANGED — new SearchTasks logic method
├── database/
│   ├── scripts/docs.query.sql                # CHANGED — access predicate on SearchDocuments
│   ├── scripts/calendar.query.sql            # CHANGED — visibility predicate + PGroonga on SearchEvents
│   ├── scripts/collaboration.query.sql       # CHANGED — new SearchTasks
│   └── migrations/
│       └── 20260905000001_search_indexes.up.sql / .down.sql   # NEW — 3 indexes
├── cmd/server.go                             # CHANGED — build and register SearchService
└── integration/
    └── federated_search_test.go              # NEW — behavioural contract

frontend/
├── packages/apis/src/
│   ├── search.ts                             # REWRITTEN — search(); searchAll() deleted
│   └── types/search.ts                       # CHANGED — SearchHit, SourceOutcome, SearchKind
├── apps/web/src/app/workspace/search/
│   ├── page.tsx                              # CHANGED — one request, kind narrowing, outcome banner
│   └── components/
│       ├── CategoryTabs.tsx                  # CHANGED — 8 categories + All
│       ├── SearchResults.tsx                 # CHANGED — one ranked list
│       ├── FilesTab.tsx                      # DELETED — files are hits like any other kind
│       └── {Document,File,WorkItem,Event}SearchResult.tsx   # NEW
├── apps/web/e2e/federated-search.spec.ts     # NEW
└── apps/mobile/src/app/(app)/
    ├── (more)/search.tsx                     # CHANGED — 8 row kinds, routing, outcome note
    └── (more)/files/[fileId].tsx             # NEW — so a File row has somewhere to go (FR-017)
frontend/apps/mobile/.maestro/
└── federated-search.yaml                     # NEW

docs/domain/
├── workspace-navigation.md                   # CHANGED — rewrite "Federated search"
├── docs-knowledge.md                         # CHANGED — search is now access-scoped
├── calendar.md                               # CHANGED — search honours visibility
├── rituals-tasks.md                          # CHANGED — work items are searchable across projects
└── README.md                                 # CHANGED — close D5, narrow D49
```

**Structure Decision**: Option 3 (mobile + API) as it actually exists in this repository —
a Go Connect-RPC backend under `backend/`, a pnpm monorepo under `frontend/` with `apps/web`,
`apps/mobile` and shared `packages/`. The feature adds exactly one backend package
(`internal/search`) and one proto file; everything else is a change to a file that already
exists.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The connect layer passes `s.TenantPool` (a `database.DBTX`) to eight concurrent logic calls instead of opening one transaction (Principle III's usual `txn.WithTxn` shape) | A `pgx.Tx` is **not safe for concurrent use**: eight goroutines sharing one transaction is a data race that will interleave protocol frames and corrupt results. `*pgxpool.Pool` satisfies `database.DBTX` and is concurrency-safe, so each source borrows its own connection. | Running the eight sources **sequentially** inside one transaction keeps the usual shape but makes latency the *sum* of eight source latencies rather than the max, which cannot meet SC-004, and makes a single slow source block the whole search, which FR-005 forbids. Search is a read with no cross-source consistency requirement, so the transaction bought nothing it was giving up latency for. |
