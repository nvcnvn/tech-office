# Quickstart: Server-Side Federated Search

How to build, run and validate feature 045. Contract details live in
[contracts/search.proto](contracts/search.proto), access predicates in
[data-model.md](data-model.md), and the behavioural contract in
[contracts/test-scenarios.md](contracts/test-scenarios.md) — none of it is repeated here.

---

## Prerequisites

Everything runs through the repository's own tooling. Do not improvise a local setup.

```bash
make infra-up                # PostgreSQL (with PGroonga + pg_trgm) and friends
make check-servers           # confirms postgres, backend and frontend are reachable
```

The backend and web dev servers are started the usual way for this repository; the
`check-*` targets tell you which one is missing if a test target refuses to run.

---

## Regenerating after a contract or schema change

Three generators, in this order. None of their outputs is ever hand-edited.

```bash
# 1. proto -> Go (Connect) and TypeScript (packages/rpc)
cd backend && buf generate

# 2. schema snapshot, after adding the forward-only migration
backend/scripts/regen-schema.sh      # regenerates backend/database/scripts/schema.sql

# 3. SQL -> typed Go
cd backend && sqlc generate
```

Changing `SearchDocuments` or `SearchEvents` changes their generated params structs, so
their existing callers in `internal/docs` and `internal/calendar` will fail to compile
until they pass the new `employee_id`. That compile error is the feature working: it is
what guarantees no caller keeps the old org-scoped behaviour.

---

## Validating the feature

### 1. Backend behaviour — the contract suite

```bash
make test-backend-one T=TestFederatedSearch     # this feature alone, while iterating
make test-backend                               # the ENTIRE suite — required for DONE
```

`make test-backend` must pass with zero failures, not just the new test. `SearchDocuments`
and `SearchEvents` now return less than they used to, so any existing scenario that
depended on the org-scoped behaviour is a real regression to look at, not noise to silence.

Also run the tenancy linter, because this feature touches four schemas' queries:

```bash
make lint-tenancy
```

### 2. Web behaviour

```bash
make test-frontend-one F=federated-search
make test-frontend                              # the ENTIRE suite — required for DONE
```

Then look at it: sign in, type a word that matches in several sources into the workspace
search box, and confirm on `/workspace/search` that Document, File, Work item and Event
rows appear alongside the existing four, that each category tab shows a count, and that
narrowing to one tab deepens that kind's list.

### 3. Mobile behaviour

```bash
make test-mobile-one F=federated-search
make test-mobile                                # the ENTIRE suite — required for DONE
```

Maestro cannot assert layout, so verify by eye on **both** platforms — the habitual test
device is an iPhone SE, and narrow-Android regressions otherwise go unnoticed (SC-010):

- 360 dp Android and iOS, all eight row kinds present, nothing clipped or overlapping;
- tapping a Document row opens the document, a Work item row opens the task at its
  project-scoped route, an Event row opens the event, a File row opens the new file detail
  screen;
- after opening one, backing out offers it as a recent item; a recent whose target has
  been deleted reports that it is gone and stops being offered.

---

## Manual checks the automated suites deliberately do not cover

### Partial failure is legible (US3, SC-005)

Make one source fail — the simplest reproduction is to revoke `docs.view` from the test
role, which exercises the `NOT_PERMITTED` path, or to point the search deadline constant in
`internal/search` at `1 * time.Millisecond` to exercise `UNAVAILABLE`. Then search and
confirm: the other sources' results are all present, and the page names the kind that is
missing rather than showing a shorter list that looks complete.

### Latency (SC-004)

Not a CI assertion — it needs a realistic corpus. Seed a workspace with a few thousand
messages, a few hundred documents, tasks and files, then:

```bash
# repeat and take the 95th percentile of the total time
curl -s -o /dev/null -w '%{time_total}\n' \
  -H "Authorization: Bearer $DEV_JWT" -H 'Content-Type: application/json' \
  -d '{"query":"invoice"}' \
  http://localhost:8080/rpc.v1.SearchService/Search
```

Expect well under 1 s. Because the eight sources run concurrently, the number to watch is
the **slowest single source**, not their sum — the per-source durations are in the
`slog` line each search emits. If one source dominates, check that its index is being used:

```sql
EXPLAIN ANALYZE SELECT ... ;   -- the query from contracts/search.query.sql
```

`idx_event_pgroonga` and `idx_file_metadata_filename_pgroonga` are new in this feature and
are the two most likely to be missing from a database that was migrated by hand.

### Vietnamese (SC-008)

Create a document titled `Quy trình đóng cửa` and search `đóng cửa`. It must come back, on
both platforms, the same way an English title does. This is what the move from
`to_tsvector('simple')` to PGroonga buys for the calendar source.

---

## Definition of Done for this feature

- [ ] `make test-backend` passes end to end
- [ ] `make test-frontend` passes end to end
- [ ] `make test-mobile` passes end to end
- [ ] `make lint-tenancy` passes
- [ ] no `t.Skip("TODO")` or `test.skip` remains from this feature's scenarios
- [ ] mobile verified by eye at 360 dp on **Android and iOS**
- [ ] `docs/domain/workspace-navigation.md` federated-search section rewritten to describe
      the server-side behaviour, with the per-source access rules (FR-023)
- [ ] `docs/domain/docs-knowledge.md` and `docs/domain/calendar.md` updated: document search
      and event search are access-scoped now, and the superseded description is **deleted**,
      not annotated
- [ ] `docs/domain/rituals-tasks.md` notes that work items are searchable across projects
- [ ] drift register in `docs/domain/README.md`: **D5 removed** (FR-023), **D49 narrowed** to
      the document tree listings alone (FR-024)
- [ ] no repository document still describes the search box as a client-side fan-out over
      four sources (SC-009)
