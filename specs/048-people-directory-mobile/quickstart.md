# Quickstart: People Directory on Mobile

How to build, run and prove this feature. The design lives in
[research.md](research.md), [data-model.md](data-model.md) and
[contracts/iam-directory.proto](contracts/iam-directory.proto); this file is the run
guide.

---

## Prerequisites

- PostgreSQL running (`make check-postgres`) with migrations applied — **no new
  migration for this feature**.
- Backend on `:8080` (`make check-backend`), Metro on `:8082` for the mobile flows.
- `buf`, `sqlc` and Go 1.24 on `PATH`.
- Maestro installed and `frontend/apps/mobile/.maestro/.env` populated
  (`make check-maestro-env`).
- At least one seeded colleague **with** a phone number and one **without**, plus one
  department with members and one with none. The Maestro flows read their names from
  `.maestro/.env`; add `MAESTRO_DIRECTORY_PERSON_WITH_PHONE`,
  `MAESTRO_DIRECTORY_PERSON_NO_PHONE` and `MAESTRO_DIRECTORY_DEPARTMENT` to
  `.env.example` alongside the existing fixtures.

## Regenerating after the contract change

```bash
cd backend && buf generate     # proto -> Go stubs + frontend/packages/rpc TypeScript
cd backend && sqlc generate    # iam.query.sql -> iam.query.sql.go
make lint-tenancy              # must be green: the new joins carry organization_id
```

`buf generate` writes both sides of the wire, so backend and mobile cannot disagree
about the shape. `backend/scripts/regen-schema.sh` is **not** run — there is no
migration, and `schema.sql` is a generated snapshot that must never be hand-edited.

---

## The behavioural contract (Constitution II)

`backend/integration/people_directory_test.go`, written as `t.Run` stubs **before** any
implementation and reviewed as the contract for this feature. Run it with:

```bash
make test-backend-one T=TestPeopleDirectory
```

```text
TestPeopleDirectory
  when a member opens the directory
    it lists the active colleagues of their own organization            US1-1, FR-001
    each entry carries display name, department, role and presence      FR-002
    it never returns date of birth, home address or hire date           US1-6, FR-008
    it excludes a deactivated employee                                  FR-005
    it excludes a de-identified deletion tombstone                      FR-005
    it never returns a person from another organization                 FR-021
    it marks the caller's own entry as self                             US2-4, FR-010
  when the roster is larger than one page
    the first page returns without waiting for the whole roster         FR-006
    the cursor walks every person exactly once, in name order           FR-006
    an exhausted page returns an empty next cursor                      FR-006
  when the member narrows by name
    a partial name finds the person                                     US1-2, FR-004
    a misspelled name still finds the person                            US1-2, FR-004
    a name in a second script finds the person                          FR-004
    narrowing searches the whole roster, not one page of it             FR-004
    a narrowed response carries no cursor                               FR-004
  when a colleague has a phone number recorded
    the entry carries the number as recorded                            US1-3, FR-007
  when a colleague has no phone number recorded
    the entry omits the number rather than returning an empty string    US1-5, FR-012
  when a colleague has no email
    the entry omits the email and still names the person                Edge case
  when a colleague belongs to no department
    the entry omits both department id and department name              Edge case
  when the request names a department
    it returns that department's active members and no one else         US3-1, FR-015
    an empty department returns no entries and no error                 US3-2, FR-017
    an unknown department id returns no entries and no error            US3-4
    a member's own department is still shown on their row               FR-018
  when the caller lacks iam.listEmployees
    the call is rejected before the handler runs                        FR-019, FR-020
  when the request names more than a hundred people
    it is rejected as an invalid argument                               Bounds
```

Every User Story and every user-observable FR above maps to at least one scenario.

**Documented exclusions** (Constitution II permits exclusions with justification):

- **No web E2E suite is added.** This feature has no web surface: the web roster,
  department tree and org chart are unchanged, and nothing in
  `frontend/apps/web/` is touched. The full Playwright suite must still pass as a
  regression guard.
- **FR-011, FR-014 (dialer hand-off) have no backend scenario.** Handing a `tel:` URI
  to the device is entirely client-side; it is covered by the Maestro flow and by
  manual validation on both platforms.
- **FR-022 (nothing written to the device address book) has no automated scenario.** It
  is a negative about a dependency that is not installed; it is verified by the absence
  of `expo-contacts` from `frontend/apps/mobile/package.json`.

---

## Manual validation

### 1. Find a colleague and call them (US1)

```
Sign in on a device as any member
  → More → People
  → the roster is listed, each row naming a person, their department and their role
  → type three letters of a colleague's family name, misspelling one
  → the list narrows to them
  → tap the row
  → the entry shows name, department, role, email and phone number
  → tap the phone row
  → the device dialer opens with the number filled in and waits for you to press call
```

Confirm the app itself never places the call, and that backing out of the dialer
returns you to the entry with the number still on screen.

### 2. Nothing to call (US1-5)

Open a colleague with no recorded number. There must be **no** phone row: not a greyed
button, not "Not provided", nothing that invites a tap.

### 3. Message a colleague (US2)

From a colleague's entry, tap Message. The direct-message conversation opens, created
on the spot if the two have never spoken. Then open **your own** entry: neither Message
nor Call is offered, and the row leads to the existing profile screen instead.

To see the failure path of FR-014, stop the backend and tap Message: an alert says so in
plain language and you stay on the entry with the person still selected.

### 4. A department is a door (US3)

```
More → Search → type a department name
  → tap the department result
  → a screen opens naming the department and listing its members
  → tap a person → their entry opens
```

Then open a department with nobody in it: the screen still names it and says plainly
that nobody is assigned yet. Then delete a department on web that you have as a recent
on mobile, and tap the recent: you are told it is no longer available and the recent
removes itself.

### 5. The number survives the network (SC-006)

Open a colleague's entry, then put the device in airplane mode and reopen the app. The
name and number are still readable, and tapping the number still opens the dialer —
calling is a device action, not a network one.

### 6. Not everybody sees it

Sign in as a member of a custom role with `iam.listEmployees` removed. The People row is
**absent** from the More menu — not present and erroring on tap.

---

## Mobile blackbox flows

Two flows, per FR-023:

```bash
make test-mobile-one F=people/directory-call
make test-mobile-one F=people/department-members
make test-mobile                      # the full suite must pass
```

- `.maestro/people/directory-call.yaml` — sign in → More → People → type a name → tap
  the person → assert the phone row is visible → tap it. The flow asserts the app leaves
  the foreground for the dialer rather than asserting a call connects; a simulator has
  no telephony, and FR-014's "could not be started" alert is the expected outcome there,
  which the flow accepts as either branch.
- `.maestro/people/department-members.yaml` — sign in → search a department → tap the
  result → assert the department name and a member row → tap the member → assert their
  entry.

Both take screenshots into `tmp/maestro-screenshots/` so the 360 dp layout can be
reviewed without a device.

---

## Mobile design checklist (Constitution XIII)

- [ ] Feature is in scope: read-only, creates and edits nothing — see the plan's
      Principle XIII justification
- [ ] Primary action ("see a colleague's number") is three taps from app open:
      More → People → the person
- [ ] Layout is purpose-built portrait: a single-column list, a full-screen entry, no
      sidebar and no dense table
- [ ] Verified at **360 dp on Android** as well as on iOS (FR-024). The habitual test
      device is an iPhone SE, so the narrow-Android case is the one that goes unnoticed
- [ ] Name is never truncated to make room for the role; department and role share the
      secondary line and truncate first
- [ ] Every interactive element has a `testID`: `menu-people`,
      `people-search-input`, `person-row-<employeeId>`, `person-phone-row`,
      `person-message-button`, `person-department-row`, `department-members-list`,
      `department-empty`
- [ ] Tap targets ≥ 44 pt, including the phone row
- [ ] No hardcoded colours — everything from `@tech-office/theme-tokens`

---

## Definition of done

- [ ] `ListDirectory` implemented with the contract in `contracts/iam-directory.proto`
- [ ] `ListDirectoryEntries` added to `iam.query.sql`; `sqlc generate` run;
      `make lint-tenancy` green
- [ ] `EmployeeSearcher` wired in `cmd/server.go`
- [ ] `listDirectory` / `getDirectoryEntry` wrappers in `packages/apis`; no screen
      imports from `rpc` directly
- [ ] Three mobile screens plus the More menu row and the search department arm
- [ ] `backend/integration/people_directory_test.go` stubs all implemented, no
      remaining `t.Skip`
- [ ] **Entire** backend suite green (`go test ./integration/...`)
- [ ] **Entire** web E2E suite green (regression guard; no new specs)
- [ ] **Entire** Maestro suite green (`make test-mobile`), including the two new flows
- [ ] Verified at 360 dp on Android and on iOS
- [ ] `docs/domain/organization-people.md` updated: the mobile client-surfaces bullet
      currently says "no ongoing org-admin surface — people appear through chat member
      lists, task assignees and presence", which this feature makes untrue. Add the
      directory, add `ListDirectory` beside `ListEmployees` / `GetEmployeeCards`, and
      refresh the status date
- [ ] `docs/domain/workspace-navigation.md` updated: the department result is no longer
      inert on mobile
- [ ] `docs/domain/README.md` drift register: add a row for the missing trigram index on
      `organization.employee.email` (found, not fixed — see research Decision 3)
- [ ] `backend/docs/SYSTEM-ARCHITECTURE.md`: record the new `iam → organization`
      logic-layer edge (`EmployeeSearcher`) in the code-level dependency graph
- [ ] Documentation committed in the same change set as the implementation

---

## Scenario-to-requirement map

| Requirement | Backend scenario | Mobile flow / manual step |
|---|---|---|
| FR-001, FR-003 | "it lists the active colleagues of their own organization" | `directory-call.yaml`; manual 1 |
| FR-002 | "each entry carries display name, department, role and presence" | manual 1 |
| FR-004 | the four narrowing scenarios | `directory-call.yaml`; manual 1 |
| FR-005 | the two exclusion scenarios | — |
| FR-006 | the three pagination scenarios | manual 1 (scroll a 500-person roster) |
| FR-007 | "the entry carries the number as recorded" | manual 1 |
| FR-008 | "it never returns date of birth, home address or hire date" | manual 1 |
| FR-009 | no write path exists on the RPC | manual 1 |
| FR-010 | "it marks the caller's own entry as self" | manual 3 |
| FR-011 | — (client-side; documented exclusion) | `directory-call.yaml`; manual 1 |
| FR-012 | "the entry omits the number rather than returning an empty string" | manual 2 |
| FR-013 | existing `createOrGetDirectMessage` coverage | manual 3 |
| FR-014 | — (client-side; documented exclusion) | manual 3 |
| FR-015, FR-016, FR-018 | the four department scenarios | `department-members.yaml`; manual 4 |
| FR-017 | "an empty department returns no entries and no error" | manual 4 |
| FR-019, FR-020 | "the caller lacks iam.listEmployees" | manual 6 |
| FR-021 | "it never returns a person from another organization" | — |
| FR-022 | — (absence of `expo-contacts`) | — |
| FR-023 | — | both flows |
| FR-024 | — | design checklist |
