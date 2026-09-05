# Phase 1 Data Model: People Directory on Mobile

**Feature**: `048-people-directory-mobile` | **Spec**: [spec.md](spec.md) |
**Contract**: [contracts/iam-directory.proto](contracts/iam-directory.proto)

This is a **read model**. No table, column, index, constraint or migration is added or
changed. `backend/database/scripts/schema.sql` is untouched, so
`backend/scripts/regen-schema.sh` is not run.

---

## Storage touched (all pre-existing, all read-only)

| Table | Read for | Schema |
|---|---|---|
| `organization.employee` | name, email, phone number, active flag | `organization` |
| `organization.department_member` | which department a person is in | `organization` |
| `organization.department` | that department's name | `organization` |
| `iam.employee_role` ⋈ `iam.role` | role names | `iam` |
| `notification.active_connection` | presence | `notification` |

No statement joins across two of those schemas. The three groups are three separate
statements whose results are merged in Go, which is how `ListEmployees` and
`GetEmployeeCards` already work in `internal/iam/connect_auth.go`.

---

## Entities

### Directory entry

A colleague as the directory presents them. Derived, never stored.

| Field | Source | Notes |
|---|---|---|
| `employee_id` | `organization.employee.id` | Equal to the `iam.identity` id for that membership |
| `given_name`, `family_name` | `organization.employee` | Both `NOT NULL` |
| `email` | `organization.employee.email` | Column is `NOT NULL DEFAULT ''`; the empty string maps to **absent**, so an org-managed worker with no email renders no email row |
| `phone_number` | `organization.employee.phone_number` | Nullable in the database; NULL **and** empty both map to absent, which is what suppresses the entire call affordance (FR-012) |
| `department_id`, `department_name` | `department_member` → `department` | Both absent when the person is in no department; never one without the other |
| `role_names` | `GetRoleNamesForEmployeeBatch` | System roles first, then alphabetical — the query's existing `ORDER BY r.is_system DESC, r.name ASC` |
| `presence_status` | `GetLatestEmployeePresenceByIDs` | `online_hidden` → `offline`; no row → `offline` |
| `is_self` | caller's employee id from the JWT | Computed in the handler, never queried |

**Withheld deliberately**: `date_of_birth`, `home_address`, `hire_date`,
`additional_info`, `login_identifier`, `is_org_managed`, `user_account_email`. The first
three are FR-008. The rest are administrative context with no use on a directory row,
and every field not sent is a field that cannot leak from a device cache.

### Department, as a directory grouping

Not modelled here. The department screen is a `ListDirectory` call with
`department_id` set, plus a `GetDepartment` call for the name. Nothing about the tree,
the parent, the manager or the counters is read.

---

## Predicates

Every row the directory can return satisfies all of:

```sql
e.organization_id = @organization_id   -- from the JWT, never from the request (FR-021)
AND e.is_active = true                 -- excludes deactivated AND tombstones (FR-005)
```

`is_active = true` is the whole of FR-005: account deletion sets `is_active = false`
while stripping the row to `'Deleted' 'user'` with a NULL phone number, so one predicate
keeps both a deactivated colleague and a tombstone out. This is the single most
important line in the feature — a directory that lists tombstones offers "Deleted user"
as somebody to call.

Then, independently, each filter that is set:

| Filter | Predicate |
|---|---|
| `employee_ids` | `e.id = ANY(@employee_ids::uuid[])` |
| `department_id` | `EXISTS (SELECT 1 FROM organization.department_member dm WHERE dm.organization_id = e.organization_id AND dm.employee_id = e.id AND dm.department_id = @department_id)` |
| `cursor` | `(lower(e.family_name), lower(e.given_name), e.id) > (@cursor_family, @cursor_given, @cursor_id)` |

The department filter is an `EXISTS`, not the display join, so filtering by department
never changes which department the row *shows*.

---

## Ordering

**Browsing** — `ORDER BY lower(family_name), lower(given_name), id`. `lower()` so that
`de Souza` and `De Souza` sort together; `id` last so the key is total and the keyset
cursor cannot skip or repeat a row.

**Narrowing** — the order `SearchEmployees` returned, which is
`MAX(relevance_score) DESC, updated_at DESC, id DESC`. The handler holds the matcher's
id sequence and re-orders the enriched rows to match it, because the enrichment query
returns them alphabetically.

---

## Bounds

| Bound | Value | Why |
|---|---|---|
| `page_size` | default 50, max 100, min 1 | 50 rows is roughly three screens on a 360 dp phone, so the second page is fetched while the first is still being read |
| `employee_ids` per request | 100 | The same cap `GetEmployeeCards` enforces |
| Narrowed results | one page, `next_cursor` empty | `SearchEmployees` caps at 100 and its relevance ordering has no correct cursor (research Decision 9) |
| Fuzzy threshold | `set_limit(0.1)` | Unchanged; owned by the existing matcher |

---

## Query contract

### `ListDirectoryEntries :many` — `backend/database/scripts/iam.query.sql`

Parameters (all filters nullable via `sqlc.narg`, per Constitution IX):

| Parameter | Type | Absent means |
|---|---|---|
| `organization_id` | `uuid` | — (required) |
| `employee_ids` | `uuid[]` | no id restriction |
| `department_id` | `uuid` | no department restriction |
| `cursor_family`, `cursor_given` | `text` | first page |
| `cursor_id` | `uuid` | first page |
| `page_size` | `int` | — (clamped by the handler before it arrives) |

Returns `id, given_name, family_name, email, phone_number, department_id,
department_name`, one row per employee — the department join cannot fan out, because
`idx_one_department_per_employee` permits at most one membership row per person.

Reused unchanged:

- `GetRoleNamesForEmployeeBatch(organization_id, employee_ids)` → `(employee_id, role_name)`
- `GetLatestEmployeePresenceByIDs(organization_id, employee_ids, responsive_window_seconds)` → `(employee_id, presence_status)`

Both are already called by `ListEmployees` / `GetEmployeeCards` with the same shape.

### Tenancy

Three statements, each pinning `organization_id = @organization_id`; the two joins
inside `ListDirectoryEntries` carry `organization_id` in the join condition
(`(dm.organization_id, dm.employee_id) = (e.organization_id, e.id)` and
`(d.organization_id, d.id) = (dm.organization_id, dm.department_id)`). No
`-- lint:cross-tenant` marker is needed or permitted: this is a tenant-scoped read.
`make lint-tenancy` must be green.

---

## Client cache model

| Query key | Holds | Persisted to MMKV |
|---|---|---|
| `["directory", departmentId ?? null, query]` | infinite pages of entries | yes |
| `["directory-entry", employeeId]` | one entry | yes |
| `["department", departmentId]` | name and description | yes |
| `["employee-permissions", employeeId]` | the caller's permission ids | yes (existing key) |

`presence` is the one root key `src/lib/query-client.ts` refuses to persist, which is
why presence travels **inside** the directory payload rather than through
`usePresence`: a stale dot restored from disk would claim a colleague is online, and a
per-row `usePresence` would be one RPC per row.

Opening a person seeds `["directory-entry", id]` from the list page that was tapped, so
the entry screen paints before its own fetch resolves, and also seeds the shared
`userProfileQueryKey(id)` cache through `usePopulateUserCache()` so avatars elsewhere
in the app stop re-fetching what the directory just loaded.

---

## Traceability

| Requirement | Where it lives in this model |
|---|---|
| FR-001, FR-003 | `ListDirectory` with no filters; a named row in the More menu |
| FR-002 | `department_name`, `role_names`, `presence_status` on every entry |
| FR-004 | `query` → `EmployeeSearcher.SearchEmployees` |
| FR-005 | `e.is_active = true` |
| FR-006 | keyset cursor + `page_size` 50 |
| FR-007 | the entry's field list, minus the withheld three |
| FR-008 | the withheld three are not columns of the response |
| FR-009 | one read RPC; no write path exists to call |
| FR-010 | `is_self` |
| FR-011, FR-012 | `phone_number` optional, absent when NULL or empty |
| FR-013 | existing `createOrGetDirectMessage` |
| FR-014 | client-side, see [quickstart.md](quickstart.md) |
| FR-015–FR-018 | `department_id` filter + `GetDepartment` for the name |
| FR-019, FR-020 | `iam.listEmployees` on the RPC; the same id in the client permission gate |
| FR-021 | `organization_id` from the JWT in all three statements |
| FR-022 | no new client storage, no `expo-contacts` |
