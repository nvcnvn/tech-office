# Implementation Plan: People Directory on Mobile

**Branch**: `048-people-directory-mobile` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/048-people-directory-mobile/spec.md`

## Summary

Give mobile the one surface it lacks — a read-only people directory that answers "who
works here, and how do I reach them?" — and, with the same screen, make the department
search result stop being a dead end.

Technically this is **one new read RPC and three new mobile screens**. No migration, no
new permission, no new index, no write path, no new dependency:

- `IAMService.ListDirectory` with `required_permissions: ["iam.listEmployees"]` — the
  permission `ListEmployees` and `GetEmployeeCards` already declare, and which the
  seeded `employee` role already holds. It returns a deliberately narrow
  `DirectoryEntry`: name, email, phone, department, roles, presence, `is_self`. Date of
  birth, home address and hire date are **not fields of the response**, which is the only
  way to satisfy FR-008 — a field the client declines to render has still reached the
  device.
- One new sqlc query, `ListDirectoryEntries`, with three independently nullable filters
  (`employee_ids`, `department_id`, an alphabetical keyset cursor) serving the directory
  list, the department member list and the person entry. Role names and presence come
  from `GetRoleNamesForEmployeeBatch` and `GetLatestEmployeePresenceByIDs`, the two batch
  queries `ListEmployees` and `GetEmployeeCards` already use — three single-schema
  statements merged in Go, no cross-schema join.
- Fuzzy narrowing (FR-004) delegates to the existing multilingual matcher,
  `OrganizationLogic.SearchEmployees`, through an `EmployeeSearcher` interface declared
  in `internal/iam` and injected in `cmd/server.go`. `internal/organization` imports
  `internal/iam`, so the interface is not stylistic — a direct import would be a cycle.
- Mobile: `(more)/people/index.tsx`, `(more)/people/[employeeId].tsx`,
  `(more)/people/department/[departmentId].tsx`, a People row in the More menu gated on
  the permission set the app already caches, and one changed line in
  `(more)/search.tsx` where the department arm currently returns without navigating.

Two things carry the risk, and neither is the query. The first is that presence and the
call affordance are both **absences done right**: presence must ride in the payload
rather than through `usePresence`, which is one RPC per employee id and would be 500
requests on a 500-row list; and a missing phone number must render nothing at all — no
disabled button, no "not provided" — because a placeholder that invites a tap is the
failure FR-012 names. The second is `e.is_active = true`, the single predicate that
keeps both deactivated colleagues and de-identified deletion tombstones out of a list of
people you can call.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / React Native 0.81 + Expo SDK 54
(mobile), PostgreSQL 18

**Primary Dependencies**: ConnectRPC + protobuf (`backend/rpc/v1/iam.proto`), sqlc
(`backend/database/scripts/iam.query.sql`), pgx v5, TanStack Query v5, expo-router,
`@tech-office/theme-tokens`, React Native `Linking` (already used in three chat
surfaces). **No new package on either side.**

**Storage**: PostgreSQL — existing tables only: `organization.employee`,
`organization.department_member`, `organization.department`, `iam.employee_role`,
`iam.role`, `notification.active_connection`. **No migration, no index, no
`regen-schema.sh` run.**

**Testing**: Go integration tests in `backend/integration/people_directory_test.go`
driven by `newTestWorld(t)`; two Maestro flows under
`frontend/apps/mobile/.maestro/people/`. No new web E2E — the feature has no web surface
(documented exclusion, see Constitution Check).

**Target Platform**: iOS 16+ and Android 8+ via Expo; backend on Linux/Docker. FR-024
requires verification at 360 dp on Android as well as iOS — the habitual test device is
an iPhone SE, so the narrow-Android case is the one that goes unnoticed.

**Performance Goals**: First page of 50 entries — roughly three screens at 360 dp — from
three bounded statements, so the first rows are usable without the 500-person roster
having been read (FR-006, SC-005). Narrowing is one round trip to the existing trigram
matcher, capped at 100 results.

**Constraints**: No new index. Browsing sorts the active roster on
`(lower(family_name), lower(given_name), id)`; at the 500-person scale of SC-005 that is
a sub-millisecond in-memory sort behind a predicate that already selects on
`organization_id`. The ceiling is tens of thousands of employees in one tenant, which no
tenant is near — a covering index is the upgrade path, not a prerequisite.

**Scale/Scope**: 1 new RPC, 3 new proto messages, 1 new SQL query, 1 new logic file,
1 new interface + 1 wiring line, 2 API wrapper functions, 3 new mobile screens, 1 menu
row, 1 changed switch arm, 1 integration test file, 2 Maestro flows. Zero migrations,
zero permissions, zero write paths.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Result: **PASS**, with
one documented deviation under Principle IX and one scope justification under Principle
XIII.*

| Principle | Verdict | How this feature satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | Read-only, no DDL. `ListDirectoryEntries` pins `organization_id = @organization_id` and carries it in both join conditions (`(dm.organization_id, dm.employee_id) = (e.organization_id, e.id)`, `(d.organization_id, d.id) = (dm.organization_id, dm.department_id)`). The two reused batch queries already pin it. No `-- lint:cross-tenant` marker — this is a tenant-scoped read, and `organization_id` comes from the JWT, never from the request (FR-021). `make lint-tenancy` must be green. |
| **II. Scenario-First Testing** | PASS with documented exclusions | The `t.Run` stubs in [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii) are written and reviewed before tasks; every User Story and user-observable FR maps to a scenario. Three exclusions are justified there: no new web E2E (no web surface), the dialer hand-off (client-side, covered by Maestro and manual steps), and FR-022 (a negative about an uninstalled dependency). Both existing suites must still pass as regression guards. |
| **III. Two-Layer Service & Proto Authorization** | PASS | `required_permissions: ["iam.listEmployees"]` is declared on the RPC, so the interceptor rejects an unentitled caller before the handler runs — which is what FR-020 wants, since the client hides the destination rather than discovering the denial. The new code is a proper two-layer split (`internal/iam/directory_logic.go` holding the bounds, the merge and the proto mapping; the handler extracting auth, clamping the page size and opening the transaction), rather than copying the connect-layer-does-everything shape of the neighbouring `ListEmployees`. Authorization is by permission id, never by role. |
| **IV. Cross-Domain Integration** | PASS | The one cross-domain hop — IAM asking the organization domain to fuzzy-match a name — goes through an `EmployeeSearcher` interface declared by the consumer and injected in `cmd/server.go`, carrying the caller's `tx`. No cross-schema SQL join is added, and no transaction is nested. IAM reading `organization.employee` and `organization.department_member` in one statement is not a new boundary crossing: `GetEmployeeCardsByIDs` in the same query file already does exactly that, and `docs/domain/organization-people.md` records employee listing living on `IAMService` as intentional. |
| **V. Observability, Simplicity & YAGNI** | PASS | One RPC instead of three; one SQL query instead of three; no new table, permission, index, cache, dependency or background job. The multi-department "+N more" affordance the spec sketches is **not** built, because `idx_one_department_per_employee` makes the state unreachable. `slog` at handler entry (filters, page size), on the searcher hop, and on failure. |
| **VI. Versioning & Breaking Changes** | PASS | Purely additive to the proto. Backend, `@tech-office/apis` and mobile ship in one change set. |
| **VII. Frontend API Wrapper & Type Safety** | PASS | Screens call `listDirectory` / `getDirectoryEntry` in `frontend/packages/apis/src/iam-directory.ts`, never `iamClient`. Native TypeScript types, not protobuf ones. Every interactive element carries a `testID` (enumerated in the [design checklist](quickstart.md#mobile-design-checklist)); all colours from `@tech-office/theme-tokens`. |
| **VIII. Cross-Stack Constant Synchronization** | PASS | No constant crosses the stack. The page-size cap and the fuzzy threshold live server-side only; the client sends `page_size` and reads `next_cursor` without knowing either bound. `presence_status` reuses the existing three-value vocabulary `EmployeeCard` already publishes. |
| **IX. UUID v7 & Nullable Cursor Params** | PASS with documented deviation | Every optional filter is `sqlc.narg`, so "no cursor" is NULL and never a zero-value UUID — the half of this principle that prevents a real bug. The cursor itself is **not** `id < @cursor`: a directory is read alphabetically and creation order is not alphabetical, so the key is `(lower(family_name), lower(given_name), id)`, passed as three nullable parameters and returned to the client base64-encoded and opaque. Recorded in Complexity Tracking. |
| **X. Structured Error Details** | PASS | The RPC has no client-fixable failure that a code cannot express: over-long `employee_ids` and a malformed UUID are `InvalidArgument`; an unknown department is an empty page, not an error; the rest are internal. Adding `BadRequest` details here would be the "detail on every error" the principle warns against. |
| **XI. Distributed-First & Horizontal Scalability** | PASS | Stateless bounded read. No process-local state; the cursor is carried by the client, so consecutive pages may be served by different instances. Presence is read from the `notification.active_connection` UNLOGGED table, which is already the shared store for exactly this. |
| **XII. Living Documentation** | PASS — required at DoD | `docs/domain/organization-people.md` currently states mobile has "no ongoing org-admin surface", and `docs/domain/workspace-navigation.md` states "Department informational (mobile has no department screen)". Both become untrue and MUST be corrected in the same change set, with status dates refreshed. `docs/domain/README.md` gains a drift row for the missing trigram index on `organization.employee.email` (found while checking Decision 3, deliberately not fixed here). `backend/docs/SYSTEM-ARCHITECTURE.md` gains the new `iam → organization` logic-layer edge. |
| **XIII. Mobile Design & Testing** | PASS with justification | See below. |

### Principle XIII scope justification

Principle XIII scopes mobile to employee-facing day-to-day features and keeps
administration on the web, with a narrow, exhaustive four-item carve-out. **This feature
does not use the carve-out and does not need an amendment**, because it is not
administration:

- It is **read-only end to end**. There is no write RPC in this change set. It creates,
  edits and deletes nothing — not a person, not a role, not a department membership.
  Every administrative act on a person stays web-only and is named in the spec's Out of
  Scope: role editing, department assignment, deactivation, credential reset, invitation,
  import, and every department mutation.
- It shows **what mobile already shows**, gathered into one place. Chat member lists,
  task assignee rows, mention pickers and search results already name colleagues, their
  department and their presence on this device. The directory adds the phone number and
  the email — the two fields a phone is uniquely good at acting on — and takes away date
  of birth, home address and hire date, so the mobile view is strictly narrower than the
  web roster, not a copy of it.
- The department screen is a **filtered people list, not a department object**. No tree,
  no org chart, no manager assignment, no counters. It exists because a search result
  that renders like a door and behaves like a wall reads as a broken app.
- Looking up a colleague's number to reach somebody who is off-shift is a day-to-day act
  for the person running a shift, not a configuration act — and the memory that owners
  run the business from a phone applies here more sharply than anywhere: the stated pain
  is an owner who has to find a laptop to read a number the workspace already holds.

The design checklist is carried into
[quickstart.md](quickstart.md#mobile-design-checklist-constitution-xiii).

## Project Structure

### Documentation (this feature)

```text
specs/048-people-directory-mobile/
├── plan.md              # This file
├── research.md          # Phase 0 output — the twelve decisions this design rests on
├── data-model.md        # Phase 1 output — read model, predicates, ordering, bounds
├── quickstart.md        # Phase 1 output — how to run and prove the feature
├── contracts/
│   └── iam-directory.proto   # The exact proto delta
├── spec.md              # Input
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/iam.proto                                 # + ListDirectory, 3 messages
├── database/scripts/iam.query.sql                   # + ListDirectoryEntries
├── database/iam.query.sql.go                        # regenerated by sqlc
├── cmd/server.go                                    # + iamLogic.SetEmployeeSearcher(orgLogic)
├── internal/iam/
│   ├── directory_logic.go                           # NEW — filters, bounds, merge, ordering
│   ├── logic.go                                     # + ListDirectory, + EmployeeSearcher, + setter
│   └── connect_auth.go                              # + thin handler beside GetEmployeeCards
└── integration/
    └── people_directory_test.go                     # NEW — the behavioural contract

frontend/
├── packages/apis/src/
│   ├── iam-directory.ts                             # NEW — listDirectory, getDirectoryEntry
│   └── index.ts                                     # + re-export
├── packages/theme-tokens/src/icons.ts               # + moreMenuIcons.people
└── apps/mobile/
    ├── src/app/(app)/(more)/
    │   ├── _layout.tsx                              # + 3 Stack.Screen entries
    │   ├── index.tsx                                # + People row, permission-gated
    │   ├── search.tsx                               # department arm navigates
    │   └── people/
    │       ├── index.tsx                            # NEW — directory list + narrowing
    │       ├── [employeeId].tsx                     # NEW — person entry, call + message
    │       └── department/[departmentId].tsx        # NEW — department members
    ├── src/components/common/directory-row.tsx      # NEW — the row all three screens share
    └── .maestro/people/
        ├── directory-call.yaml                      # NEW
        └── department-members.yaml                  # NEW

docs/domain/
├── organization-people.md                           # mobile surfaces; + ListDirectory
├── workspace-navigation.md                          # department result is no longer inert
└── README.md                                        # + drift row (employee email trgm index)

backend/docs/SYSTEM-ARCHITECTURE.md                  # + iam → organization (EmployeeSearcher)
```

**Structure Decision**: Mobile client + Go API service in the existing monorepo. No new
package, no new service. `people/` sits beside `docs/` and `files/` under `(more)`,
which is the shape those two established — an `index` list plus a detail route, with the
detail's back button belonging to whatever opened it rather than to the More menu.
`directory_logic.go` sits beside the other `internal/iam` logic files;
`directory-row.tsx` sits beside `user-card.tsx`, which it deliberately does **not**
extend: `UserCard` fetches per employee id through `useUserProfile`, and the directory
already holds every field it would fetch.

## Complexity Tracking

**Post-Phase-1 re-evaluation: still PASS.** Phase 1 added no table, no migration, no
index, no permission, no background job and no cross-schema join, so no gate moved. The
two places the design could have broken a principle — Constitution IV (the fuzzy matcher
lives in another domain whose package imports this one) and Constitution I (three
schemas are read) — are the two the complexity budget was spent on: a consumer-declared
interface, and three single-schema statements merged in Go.

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Cursor is an alphabetical `(family, given, id)` keyset, not Principle IX's `id < @cursor` | A directory is read in name order (FR-001, SC-001); a uuidv7 cursor encodes creation order, which cannot express an alphabetical page boundary | Ordering the browse list by id would put the roster in signup order, where nobody can find anybody by scrolling. The nullable-parameter half of Principle IX is honoured exactly — three `sqlc.narg` parameters, never a zero-value UUID |
| A new `EmployeeSearcher` interface + one wiring line in `cmd/server.go` | FR-004 requires *the same* fuzzy multilingual matcher the workspace already applies; `internal/organization` imports `internal/iam`, so a direct import is a cycle | Copying the trigram `UNION ALL` into `iam.query.sql` gives two copies of a non-trivial matcher that drift silently. Two client round trips (search for ids, then enrich) puts a sequential request in the path of every keystroke pause, against SC-005's one-second budget |
| A new RPC rather than reusing `ListEmployees` | `ListEmployees` returns date of birth, home address and hire date, which FR-008 forbids reaching the device at all; it also has the wrong pagination and none of the enrichment | Hiding the three fields client-side still sends them, caches them in React Query and writes them to MMKV. Stripping them from `ListEmployees` would regress the web HR roster to save one proto message |
| A `directory-row.tsx` rather than reusing `UserCard` | `UserCard` resolves each person through `useUserProfile` → `GetEmployeeCards`, one request per id when the cache is cold; the directory payload already contains every field it would fetch | Seeding the cache row by row would work but leaves the row's presence dot on `usePresence`, which is a second RPC per row. The directory's presence rides in the payload |

| Deviation from spec | Why | Recorded where |
|---|---|---|
| A person has **one** department; no "+N more" affordance is built | `idx_one_department_per_employee` is a UNIQUE index on `(organization_id, employee_id)`, so the multi-department state the spec's edge case describes cannot exist | [research.md](research.md#decision-5--a-person-has-at-most-one-department-the-specs-multi-department-case-is-unreachable) |
| Narrowed results are one capped page, not a paginated list | The existing relevance-ordered matcher has no correct cursor, and a directory search needing a second page has not narrowed | [research.md](research.md#decision-9--narrowed-results-are-one-capped-page-only-browsing-paginates) |
| A person row in **global search** still opens the conversation; only directory and department rows open the person entry | FR-015 and SC-003 are about the inert row, which is the department row alone; rerouting person results would add a tap to a path that works | [research.md](research.md#decision-11--the-global-search-person-row-is-left-alone-only-the-department-row-changes) |
| "Role" is the IAM role name | The workspace records no job title, and the web roster already uses the word this way; a title field would be the new person-facing field the spec forbids | [research.md](research.md#decision-12--role-means-the-iam-role-name) |
