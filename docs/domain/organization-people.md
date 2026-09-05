# Organizations & People

Tenant creation, the employee roster, and the department hierarchy. Owned by
`internal/organization` (`OrganizationService`) and `internal/department`
(`DepartmentService`).

**Status date: 2026-09-06.** Supersedes specs 001, 003, 004, 005, 006, 025, 035, 046, 048.

## Organization

`public.organization` is the tenant root. Every tenant table carries an
`organization_id` referencing it, leading every primary key and unique constraint;
`make lint-tenancy` enforces that and the matching predicate in every query.

| Column | Notes |
|---|---|
| `subdomain` | `varchar(63)`, unique. The tenant key used in URLs and PIN login, and the "workspace address" users see. Validated server-side — see [Workspace address](#workspace-address). |
| `company_name` | display name |
| `status` | `active \| suspended \| deleted` |
| `project_id`, `app_id` | `NOT NULL` UUIDs, commented "legacy external auth project (deprecated)". Populated with fresh UUIDs at registration and otherwise unused — Zitadel residue (see [D6](README.md#drift-register)). |
| `client_id` | nullable OAuth2 client ID |

`GetOrganizationBySubdomain` is `allow_unauthenticated` — the login pages call it to
resolve the tenant before anyone has a token.

### Workspace address

`internal/organization/subdomain.go` owns the format, and registration enforces it before
any insert. Before feature 035 there was **no** validation at all: a duplicate reached the
UNIQUE index and surfaced to the caller as a raw pg error.

| Rule | Value |
|---|---|
| Charset | `a-z`, `0-9`, `-` |
| Boundaries | must start and end alphanumeric |
| Length | 3–63 characters (a DNS label cannot exceed 63 octets) |
| Repeats | no consecutive hyphens |
| Reserved | `www`, `api`, `app`, `admin`, `mail`, `static`, `assets` |

`Derive(companyName)` produces a candidate from a business name — accents folded via NFD,
apostrophes dropped so `Anna's` becomes `annas`, every other run of non-alphanumerics
collapsed to one hyphen, trimmed and truncated. `Anna's Café` → `annas-cafe`. It returns
`""` when the name yields nothing usable, in which case the caller must ask rather than
invent. `NextVariant(base, n)` gives the disambiguated form `annas-cafe-2`.

`CheckSubdomainAvailable` (`allow_unauthenticated`, called before an account exists)
reports whether an address is free and, when it is not, returns the next free variant so
the client can offer it without a second round trip. A **taken but valid** address is a
successful response with `available=false`, not an error; only a malformed one returns
`InvalidArgument`. The search for a variant is bounded at 50 attempts.

`RegisterOrganizationWithAdminPassword` validates format and availability before insert and
returns `AlreadyExists` (taken) or `InvalidArgument` (malformed), both carrying a
`google.rpc.BadRequest` naming the `subdomain` field, so a six-field signup form knows which
input to correct. The stored value is normalized (trimmed, lower-cased).

The rules are mirrored client-side in `packages/apis/src/organization.ts`
(`deriveSubdomain`, `isValidSubdomain`, `normalizeSubdomain`, `SUBDOMAIN_MIN_LENGTH`,
`SUBDOMAIN_MAX_LENGTH`) so a form can validate and show the derived address without a round
trip. The server remains the authority; the Go table test in `subdomain_test.go` is the
reference the TypeScript copy must match. Nothing enforces that the two stay in step — the
TypeScript copy was checked against the table by hand, once.

**Resolving which workspace a web request is for** is `extractOrganization` in
`apps/web/src/app/config/auth.ts`: the hostname's leading label if there is one, otherwise
`?org=`. A hostname that is an IP literal is not a subdomain, and is rejected before the
split — a dev server on `127.0.0.1` used to resolve the tenant as `127`, and because
hostname wins over `?org=` that could not then be corrected by hand.

### Registration

`RegisterOrganizationWithAdminPassword` is one transaction doing seven steps
(`internal/organization/logic.go`):

1. `public.organization`
2. `iam.identity` for the admin (kept because `organization.employee` FKs to it; the email
   now lives on the employee row and queries no longer join through identity)
3. `organization.employee` — reusing the identity's UUID so the FK is satisfied
4. `iam.user` — the global account
5. `iam.password_credential` — bcrypt
6. `SeedOrgRolesFromDefaults` + `SeedOrgRolePermissionsFromDefaults` copy the three system
   roles from the reference tables, then assign `owner` to the admin
7. a default collaboration project, via the injected `CollaborationLogic`

Step 7 is why `orgLogic.SetCollaborationLogic(...)` is called after the collaboration
service is built in `cmd/server.go` — a deliberate late injection to keep the dependency
pointing the right way (T0 organization must not import T3 collaboration at
construction time).

## Employees

`organization.employee`: `given_name`, `family_name`, `email`, `hire_date`,
`date_of_birth`, `phone_number`, `home_address`, `additional_info` (JSONB), `is_active`.
The row ID equals the `iam.identity` ID for that org membership, so "employee ID" and
"identity ID" are interchangeable within one organization — most domain tables FK to the
employee.

`date_of_birth` and `phone_number` are not just profile data: PIN validation rejects a PIN
derived from either (see [auth-identity.md](auth-identity.md#3-pin-org-managed-worker-accounts)).

**One row per (organization, person).** A person in two workspaces has two employee rows,
and `AcceptInvitation` creates whichever one this organization is missing — keyed on
whether the row exists here, not on whether the user is new. Keyed the other way it
created nothing for an existing user, and the role assignment that follows then failed on
`fk_employee_role_employee`, so invite→accept could never produce a second membership.

**The row survives its person.** Deleting an account does not delete the employee row: it
strips it to a de-identified tombstone (`given_name` → `'Deleted'`, `family_name` →
`'user'`, `email` → `''`, the rest NULL, `is_active` → false) so the organization keeps its
messages, files, tasks and documents while they stop naming anybody. Roughly fifty columns
across a dozen schemas FK to this row, and nulling every one of them on delete would be a
sprawling and fragile cascade, so this is the shape erasure takes here. See
[compliance-safety.md](compliance-safety.md).

### Listing and cards

`ListEmployees` (paginated), `GetEmployeeCards` (batch profile lookup for avatars and
hovercards) and `ListDirectory` (the mobile people directory) live on `IAMService`, not
`OrganizationService` — a historical split worth knowing when searching for the handler.
All three declare `iam.listEmployees`, which the seeded `employee` role holds.

`ListDirectory` is deliberately the narrowest of the three. It returns name, email, phone
number, department id and name, IAM role names, presence and an `is_self` flag, and
**date of birth, home address and hire date are not fields of the response at all** — a
field the client declines to render has still reached the device and its cache, and both
date of birth and phone number constrain PIN validity. It answers three shapes from one
query, selected by which of its independently nullable filters is set:

| Filter | Shape |
|---|---|
| none | the whole active roster, alphabetical by `(lower(family_name), lower(given_name), id)`, cursor-paginated |
| `department_id` | that department's active members, same order |
| `employee_ids` | exactly those people, capped at 100 as `GetEmployeeCards` is |

A non-empty `query` narrows any of the three through
`OrganizationLogic.SearchEmployees` — the same trigram matcher federated search uses,
reached through an `EmployeeSearcher` interface `internal/iam` declares and `cmd/server.go`
injects, because `internal/organization` already imports `internal/iam`. A narrowed
response is one relevance-ordered page and always carries an empty `next_cursor`.
The match is org-scoped on every leg, but *how loose* it is is currently not
deterministic: the matcher sets the trigram threshold by mutating a session GUC that
it never resets, so a search's result set depends on whether its pooled connection has
already served one (drift D70).

The cursor is an opaque base64 encoding of `(lower(family_name), lower(given_name), id)`,
not a uuidv7 keyset: a directory is read in name order and creation order cannot express
an alphabetical page boundary. Page size defaults to 50 and clamps to 1..100.

`e.is_active = true` is the load-bearing predicate: it keeps both deactivated colleagues
and de-identified deletion tombstones out, so the directory never offers "Deleted user" as
somebody to ring. Absent `email` and `phone_number` are absent fields rather than empty
strings, and department id and name are both present or both absent.

Role names and presence come from `GetRoleNamesForEmployeeBatch` and
`GetLatestEmployeePresenceByIDs` — the same two batch queries `ListEmployees` and
`GetEmployeeCards` use — merged in Go, so no statement crosses a schema. `online_hidden`
reads as `offline`, the peer-visibility rule `EmployeeCard` already applies.

### Import

Two-phase, on `IAMService`, gated by `iam.importEmployees` (which neither `operator` nor
`employee` holds by default — owners only):

- `PreviewEmployeeImport` parses the CSV/Excel upload and returns per-row validation
  results without writing.
- `ExecuteEmployeeImport` commits the accepted rows.

Web UI: `/workspace/organization/import-employees` and
`components/EmployeeImportDialog.tsx`. Client: `packages/apis/src/iam-employee-import.ts`.

### Names for other domains

`OrganizationLogic.ListEmployeeNames(ctx, tx, orgID, ids)` returns one display name per
employee id that exists in the organization, over the same `GetEmployeeCardsByIDs` query
the employee cards use. An id with no row is absent from the map rather than an error.

It exists so a caller outside this domain can name a person without joining
`organization.employee` from its own schema — `internal/collaboration` uses it for the
assignee line on a task link preview card, behind an interface it declares itself to avoid
an import cycle.

## Departments

`organization.department` is an adjacency-list tree (`parent_department_id`, self-FK,
`ON DELETE RESTRICT`, plus a `no_self_reference` CHECK). Denormalised counters
`member_count`, `manager_count`, `child_count` keep tree rendering cheap.

`organization.department_member` maps employees to departments with
`role IN ('member','manager')`.

`DepartmentService` (12 RPCs):

| RPC | Permission |
|---|---|
| `GetDepartmentTree`, `GetDepartment`, `GetDepartmentMembers`, `GetUnassignedEmployees` | `dept.view` |
| `CreateDepartment` | `dept.create` |
| `UpdateDepartment` | `dept.update` |
| `MoveDepartment` | `dept.move` |
| `DeleteDepartment` | `dept.delete` |
| `AssignEmployeeToDepartment` | `dept.assignEmployee` |
| `RemoveEmployeeFromDepartment` | `dept.removeEmployee` |
| `SetDepartmentManager`, `ClearDepartmentManager` | `dept.setManager` |

Department membership is **denormalised into the presence layer**:
`notification.active_connection.department_ids` is a `uuid[]` populated when an SSE
connection is established, with a GIN index, so department-targeted notification routing is
a single array-overlap query instead of a cross-schema join. It is refreshed **only on
reconnect** — a department change does not retarget an open connection.

Departments are also assignee pools for rituals
(`collaboration.ritual_definition_department_pool`, `round_robin` or `least_assigned`
strategy) — see [rituals-tasks.md](rituals-tasks.md#assignment).

## Search

`OrganizationService` owns fuzzy search over people and departments:
`SearchEmployees`, `SearchDepartments`, `AutocompleteEmployees`, `AutocompleteDepartments`.

Multilingual matching uses PostgreSQL trigram GIN indexes plus language detection via
`lingua-go` (`internal/organization/language_detector.go`). Employees are indexed on
`given_name` and `family_name` **separately** rather than on a concatenation — the comment
in `schema.sql` gives the reason: smaller indexes, with result merging done in the
application layer.

`SearchEmployees` and `SearchDepartments` are also two of the eight sources
`SearchService.Search` fans out over; the federated searcher calls this domain's logic
layer rather than its RPCs, and neither query changed. See
[workspace-navigation.md](workspace-navigation.md#federated-search).

## Client surfaces

- Web: `/signup` (registration), `/workspace/organization` with tabs — Overview,
  Employees, Departments, Permissions — plus `DepartmentOrgChart.tsx` /
  `DepartmentTreeView.tsx` for the org chart, and the assign/move/manager dialogs.
- Mobile: a **read-only people directory** under More → People
  (`app/(app)/(more)/people/index.tsx`), gated on `iam.listEmployees` — a member without
  the permission does not see the row at all. A person's entry
  (`people/[employeeId].tsx`) shows name, department, role, presence, email and, when one
  is recorded, a phone row that hands a `tel:` URI to the device dialer; when no number is
  recorded it renders nothing rather than a disabled control. Message opens or creates the
  direct-message conversation; your own row leads to the profile screen and offers neither
  Message nor Call. `people/department/[departmentId].tsx` lists one department's members.
  The directory creates, edits and deletes nothing — every administrative act on a person
  stays web-only. People also appear through chat member lists, task assignees and
  presence. **First-run onboarding is the other exception**: `app/(auth)/signup`
  creates the organization and `app/(onboarding)/add-teammate` creates the first
  org-managed accounts. Constitution Principle XIII permits exactly these two otherwise-web-only
  capabilities, and only during first run; role editing, department management, bulk import,
  deactivation and credential reset for other members stay web-only. See
  [auth-identity.md](auth-identity.md#client-surfaces).
- Clients: `packages/apis/src/organization.ts` (`registerOrganization`,
  `checkSubdomainAvailable`, `deriveSubdomain`), `department.ts`, `iam-employee-list.ts`,
  `iam-employee-import.ts`, `iam-directory.ts` (`listDirectory`, `getDirectoryEntry`).

## Tests

`integration/organization_onboarding_test.go`, `mobile_owner_onboarding_test.go`
(address derivation, collision, typed conflicts, owner-to-teammate flow),
`department_test.go`, `iam_employee_cards_test.go`, `people_directory_test.go`,
`multi_tenancy_test.go`.
`internal/organization/subdomain_test.go` is the derivation/validation reference table.

Mobile: `.maestro/onboarding/owner-signup.yaml`, `.maestro/people/directory-call.yaml`,
`.maestro/people/department-members.yaml`.

## Known drift

Nothing domain-specific beyond the platform-wide items. Two things that read as drift but
are not:

- `ListEmployees` / `GetEmployeeCards` / `ListDirectory` / employee import living on
  `IAMService` rather than `OrganizationService` is intentional, not a mistake.
- `iam.identity` looks vestigial for email-based users since the email moved to
  `organization.employee`. It is still load-bearing: it is the FK target for
  `organization.employee`, `iam.credential` and `iam.account_lockout`, and it is where
  `login_identifier` lives for PIN accounts.
