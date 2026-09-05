# Phase 0 Research: People Directory on Mobile

**Feature**: `048-people-directory-mobile` | **Date**: 2026-09-05 |
**Spec**: [spec.md](spec.md)

Every decision below was checked against the code, not against the numbered specs.
`docs/domain/organization-people.md` (status date 2026-09-04) was read first, per
Constitution XII, and the two facts it flags — that employee listing lives on
`IAMService` rather than `OrganizationService`, and that a deleted account leaves a
de-identified employee row behind — both shape the design.

---

## Decision 1 — A new `IAMService.ListDirectory`, not a reuse of `ListEmployees`

**Decision**: Add one read RPC, `IAMService.ListDirectory`, returning a narrow
`DirectoryEntry`. Do **not** call the existing `ListEmployees` from mobile.

**Rationale**: `ListEmployees` is the web roster and returns
`date_of_birth`, `home_address` and `hire_date` on every row
(`rpc/v1/iam.proto`, `EmployeeListItem` fields 5, 6 and 8). FR-008 forbids those three
on any mobile surface, and the spec's own reasoning is that date of birth and phone
number both constrain PIN validity
(`docs/domain/auth-identity.md#3-pin-org-managed-worker-accounts`), so widening their
audience widens a credential-guessing surface. A field the client merely declines to
render has still been sent to the device, cached by React Query and written to MMKV.
The only way to satisfy FR-008 is for the payload not to contain them.

Three further mismatches make reuse the longer path anyway:

| `ListEmployees` gives | The directory needs |
|---|---|
| page-number pagination (`page_number`, `page_size`, `total_pages`) | a cursor, so a 500-person roster streams in (FR-006) |
| no department, no presence | both, on every row (FR-002) |
| an exact-match `email_filter` | fuzzy multilingual name matching (FR-004) |

**Alternatives considered**:

- *Reuse `ListEmployees` and hide the extra fields client-side.* Rejected: violates
  FR-008 as argued above, and still leaves pagination and enrichment unsolved.
- *Strip the three fields from `ListEmployees` itself and share one RPC with web.*
  Tempting under the project's no-backward-compatibility stance, but the web roster
  legitimately shows hire date and date of birth — that is an HR view, and removing
  them would be a feature regression on web to save one proto message here.
- *Reuse `GetEmployeeCards`.* It has no phone number and no role, which are the two
  fields the feature exists for.

## Decision 2 — The permission is the existing `iam.listEmployees`; no new permission

**Decision**: `ListDirectory` declares
`required_permissions: ["iam.listEmployees"]`. No migration, no new permission id,
no change to `public.default_role_permission`.

**Rationale**: FR-019 wants every role that may list colleagues to see the directory,
"which by default includes the employee role". `iam.listEmployees` is exactly that
permission, and the seed in `database/migrations/20260310120000_init.up.sql` grants it
to `employee` — the employee exclusion list names `iam.inviteUser`,
`iam.cancelInvitation`, `iam.importEmployees`, `iam.manageRoles`, the four writing
`dept.*` permissions and `files.updateQuota`, and nothing else. Introducing
`people.viewDirectory` would create a permission every existing organization would
have to be migrated into, to express a rule that already exists.

FR-020 (hide the destination rather than erroring on tap) is satisfied client-side by
the permission set the mobile app already reads: `getEmployeePermissions(employeeId)`
under the query key `["employee-permissions", employeeId]`, the same cache entry
`(app)/(tasks)/index.tsx` uses to decide whether to offer "Create project". The row is
absent, never disabled — the pattern feature 044 established.

## Decision 3 — Fuzzy narrowing delegates to `OrganizationLogic.SearchEmployees` through a locally-declared interface

**Decision**: `internal/iam` declares its own one-method interface

```go
type EmployeeSearcher interface {
    SearchEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID,
        queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchEmployeesRow, error)
}
```

satisfied by `organizationLogicImpl`, injected with a setter in `cmd/server.go`
immediately after both logics are constructed (`orgLogic` on line 153, `iamLogic` on
line 154).

**Rationale**: FR-004 says narrowing must use "the same fuzzy, multilingual person
matching the workspace already applies to people". That matcher is the
`SearchEmployees` query in `organization.query.sql` — a three-leg `UNION ALL` over
email, given name and family name with `set_limit(0.1)`, of which the two name legs ride
the `idx_employee_given_name_trgm` and `idx_employee_family_name_trgm` GIN indexes,
paired with `internal/organization/language_detector.go`. Calling it is the requirement;
copying its SQL into `iam.query.sql` would be a second copy of a non-trivial query that
can silently drift from the first.

Noted while checking this, **not** fixed here: there is no trigram index on
`organization.employee.email`, so the email leg of `SearchEmployees` is a sequential
scan. `iam.idx_identity_email_trgm` covers `iam.identity.email`, which the query does not
read since the email moved onto the employee row. This is pre-existing and affects the
existing search surfaces identically; it belongs in the drift register, not in this
feature's diff.

A setter rather than a constructor argument because `internal/organization` **imports
`internal/iam`** (`internal/organization/logic.go`), so a direct
`iam → organization` package import is an import cycle. Declaring the narrow interface
on the consumer side is the pattern `SYSTEM-ARCHITECTURE.md` already documents for
`chat`, `voice` and `iam`, and the setter mirrors `orgLogic.SetCollaborationLogic` and
`collaborationLogic.SetEmployeeNameLookup`, both of which exist for the same reason. A
setter also leaves the three other `NewIAMLogic` call sites (`cmd/seed_demo.go`,
`integration/iam_auth_methods_test.go`) untouched.

Constitution IV is satisfied: the cross-domain hop is a logic-layer interface call
carrying the caller's `tx`, not a cross-schema SQL join.

**Alternatives considered**:

- *Two client round trips — `searchEmployees` for ids, then `ListDirectory` for the
  rows.* No backend edge at all, but it puts a sequential second request in the path
  of every keystroke pause, against SC-005's one-second budget, and moves result
  ordering into the client.
- *Duplicate the trigram `UNION ALL` in `iam.query.sql`.* Rejected under Constitution V
  and the reuse rule: two copies of the same matcher is precisely the drift FR-004
  warns against.

## Decision 4 — One SQL query, three optional filters, serving all three screens

**Decision**: A single new query, `ListDirectoryEntries :many` in
`backend/database/scripts/iam.query.sql`, with three independently nullable filters —
`employee_ids`, `department_id`, and a three-part alphabetical keyset cursor — serves
the directory list, the department member list and the person entry.

**Rationale**: The three screens differ only in their `WHERE` clause. The browse list
pins none of the filters; the department screen pins `department_id`; the person entry
pins `employee_ids` to one id; the search path pins `employee_ids` to what the searcher
returned. One query means one place where `organization_id`, `is_active = true` and the
department join are written, so no screen can accidentally be the one that lists
tombstones.

Role names and presence are **not** joined into it. They come from the two batch
queries that already exist in the same file and are already used for exactly this by
`ListEmployees` and `GetEmployeeCards`: `GetRoleNamesForEmployeeBatch`
(`iam.employee_role ⋈ iam.role`, one schema) and `GetLatestEmployeePresenceByIDs`
(`notification.active_connection`, one schema). Three single-schema statements, no
cross-schema join anywhere — Constitution I.

Presence in the payload, rather than the `usePresence` hook per row, is a hard
requirement of the same principle applied to the client: `usePresence` issues one
`GetEmployeePresence` RPC per employee id, which on a 500-row list is 500 requests.

## Decision 5 — A person has at most one department; the spec's multi-department case is unreachable

**Decision**: `DirectoryEntry` carries one optional `department_id` /
`department_name` pair, not a repeated field. No "+N more" affordance is built.

**Rationale**: `schema.sql` line 6523 —

```sql
CREATE UNIQUE INDEX idx_one_department_per_employee
    ON organization.department_member USING btree (organization_id, employee_id);
```

A second membership row for the same person cannot be inserted. The spec's edge case
("a person in several departments: the row shows one and indicates there are more") and
FR-007's "every department they belong to" describe a state the database forbids, so
the honest contract is a single optional department, and "every department they belong
to" is satisfied by showing the one.

[ASSUMPTION: modelled as a single optional department rather than a repeated field,
because `idx_one_department_per_employee` makes multi-membership impossible today.
Building the repeated field and the "+N" affordance would be shipping UI for a state no
row can be in. If the unique index is ever dropped, this is one proto field and one row
component to widen.]

## Decision 6 — The department screen gets its name from `DepartmentService.GetDepartment`

**Decision**: The department screen issues two queries: `getDepartment(departmentId)`
for the name, and `listDirectory({ departmentId })` for the members. `ListDirectory`
does not echo a department name.

**Rationale**: FR-017 requires a department with no members to still be named, which a
member-derived name cannot do. `GetDepartment` already exists, already carries
`dept.view` (held by the employee role by default), and returns `NotFound` for a
department that has been deleted — which is exactly US3 scenario 4, the stale recent
that must evict itself. Deriving the name inside `ListDirectory` would mean `IAMService`
reading `organization.department` for its own display purposes and inventing a second
not-found path.

The two queries are issued in the same render, so the screen is bounded by the slower
one rather than by their sum.

## Decision 7 — Tap-to-call is `Linking.openURL("tel:…")` in a try/catch, with no `canOpenURL` probe

**Decision**: The phone row calls `Linking.openURL` with a `tel:` URI built from the
recorded number, inside `try/catch`; a rejection produces the plain-language alert
FR-014 requires and leaves the number on screen.

**Rationale**: `Linking.canOpenURL` on Android 11+ requires a matching `<queries>`
entry in the manifest for the scheme, and returns `false` without one even when a
dialer is installed — so a `canOpenURL` guard is the most likely way to make the button
silently do nothing on a real Android phone while working on the iOS simulator the
owner habitually tests on. `openURL` rejects on its own when nothing handles the
intent, which is the same signal without the manifest dependency. `Linking` from
`react-native` is already used in `chat-message-body.tsx`, `voice-call-record.tsx` and
`review-queue-card.tsx`; no new dependency.

The number is sanitised to `+` plus digits before being placed in the URI, so spaces,
parentheses and dashes as typed by whoever imported the roster cannot break the URI.
The **displayed** number keeps its original formatting.

Handing off to the dialer rather than dialling is FR-011 and is also what the platform
allows: `tel:` opens the dialer pre-filled and waits for the person to press call.

## Decision 8 — Alphabetical keyset cursor, a documented deviation from Principle IX

**Decision**: The cursor is an opaque base64 string encoding
`family_name \x1f given_name \x1f id`, and the predicate is a row comparison
`(lower(family_name), lower(given_name), id) > (@cursor_family, @cursor_given, @cursor_id)`
with all three parts passed as `sqlc.narg` so absent means first page.

**Rationale**: Principle IX's `id < cursor` form encodes creation order. A directory is
read alphabetically — FR-001 and SC-001 both assume you can find somebody by scrolling
— and creation order is not alphabetical, so a UUID-only cursor cannot express this
page boundary. The nullable-parameter half of Principle IX is honoured exactly: three
`sqlc.narg` parameters, never a zero-value UUID standing in for "no cursor".

Opaque to the client so the ordering key can change without a client release.

**No new index.** Ordering sorts the active roster; at the 500-person scale of SC-005
that is a sub-millisecond in-memory sort behind a filter that already selects on
`(organization_id)`. A covering `(organization_id, lower(family_name), lower(given_name), id)`
index becomes worth its write cost somewhere in the tens of thousands of employees per
tenant, which no tenant is near.

## Decision 9 — Narrowed results are one capped page; only browsing paginates

**Decision**: When `query` is non-empty the response carries up to `page_size` (max
100) relevance-ordered entries and an empty `next_cursor`.

**Rationale**: `SearchEmployees` caps at 100 internally and orders by relevance, and its
own cursor (`id < cursor`) does not compose with a relevance ordering — paging it would
produce a page boundary that skips and repeats rows. The behaviour the member wants
from a search box is the right person near the top, not the hundred-and-first match;
the answer to "too many results" is another character, not another page.

[ASSUMPTION: narrowing returns a single capped page rather than paginating, because the
existing relevance-ordered matcher has no correct cursor and a directory search that
needs a second page has not narrowed. Browsing, which is where 500 rows actually
arrive, does paginate.]

## Decision 10 — Offline readability is the existing MMKV query persistence; no new store

**Decision**: The directory and person queries use plain React Query keys
(`["directory", …]`, `["directory-entry", employeeId]`) and inherit persistence from
`src/lib/query-client.ts`. Nothing is written to disk by this feature directly.

**Rationale**: `setupQueryPersistence()` already mirrors the whole query cache into
MMKV with a 24-hour horizon, excluding only the `presence` root key. A person whose
entry was opened while online therefore still has their name and number after a
restart with no connectivity, which is SC-006, and calling is a device action that does
not need the network at all. FR-022 — no contact details written beyond what renders
the screen, and nothing into the device address book — is satisfied by adding no
storage and no `expo-contacts` dependency.

## Decision 11 — The global search person row is left alone; only the department row changes

**Decision**: In `(app)/(more)/search.tsx`, the `case "department"` arm gains a
`router.push` to the new department screen. The `case "person"` arm keeps opening the
direct-message conversation.

**Rationale**: FR-015 and SC-003 are about the inert row, and that is the department
row alone — the person row already navigates somewhere real. Rerouting person results
to the person entry would add a tap to a path that today reaches the conversation in
one, for no requirement in this spec.

[ASSUMPTION: a person result in global search continues to open the conversation, while
a person row inside the directory and on a department screen opens the person entry.
The two rows sit in different places and answer different questions — "message this
person" versus "who is this person" — and only the department row was reported as
broken.]

## Decision 12 — "Role" means the IAM role name

**Decision**: The `role` shown on a row and on the person entry is the employee's IAM
role name or names — "Owner", "Employee", "Operator" or an organization's custom role.

**Rationale**: There is no job-title column. `organization.employee` holds
`given_name`, `family_name`, `email`, `hire_date`, `date_of_birth`, `phone_number`,
`home_address`, `additional_info` and `is_active` — no title. The web roster's "role"
column is `role_names` from `iam.employee_role ⋈ iam.role`, and FR-009's list of
forbidden mobile actions ("role changes") uses the word in the same sense.

[ASSUMPTION: role is the IAM role name, because the workspace records no job title and
the web roster already uses the word this way. Adding a title field would be the "new
person-facing field" the spec's Out of Scope forbids.]

## Verified against the code

| Claim | Where checked |
|---|---|
| `employee` role holds `iam.listEmployees`, `dept.view`, `org.searchEmployees` | `database/migrations/20260310120000_init.up.sql`, employee exclusion list |
| `ListEmployees` returns DOB, home address, hire date | `rpc/v1/iam.proto`, `EmployeeListItem` fields 5, 6, 8 |
| One department per employee is enforced | `database/scripts/schema.sql:6523` |
| IAM already reads `organization.employee` and joins `department_member` | `iam.query.sql`, `GetEmployeeCardsByIDs` |
| Role names and presence already have batch queries | `iam.query.sql`, `GetRoleNamesForEmployeeBatch`, `GetLatestEmployeePresenceByIDs` |
| `internal/organization` imports `internal/iam` (so the reverse is a cycle) | `internal/organization/logic.go` imports |
| Department search hits already carry `departmentId` | `packages/apis/src/search.ts`, `protoTargetToNative` |
| The department row is deliberately inert today | `(app)/(more)/search.tsx`, `case "department"` |
| Mobile reads its permission set under `["employee-permissions", employeeId]` | `(app)/(tasks)/index.tsx` |
| The query cache is persisted to MMKV except `presence` | `src/lib/query-client.ts` |
| Tombstones are `is_active = false` | `docs/domain/organization-people.md`, "The row survives its person" |
