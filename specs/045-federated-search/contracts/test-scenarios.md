# Behavioural Contract: Server-Side Federated Search

Constitution principle II makes these scenarios planning artifacts first and test files
second. They are the contract for feature 045 and are **approved as part of this plan**,
before `/speckit-tasks` runs and before any code is written.

- Backend: `backend/integration/federated_search_test.go` — `testWorld` pattern, Connect
  client with a dev JWT, one nested `t.Run` per behaviour, `// FR-XXX` traceability
  comments.
- Web E2E: `frontend/apps/web/e2e/federated-search.spec.ts` — Playwright, mirroring the
  backend scenario names.
- Mobile: `frontend/apps/mobile/.maestro/federated-search.yaml` — one happy-path flow.

Every user story and every user-observable FR appears below. Exclusions are listed at the
end with justification.

---

## Fixture

One world, built once, used by every scenario. The distinctive word is `zarquon` — chosen
so no seeded content collides with it, and so "matched nothing anywhere" is easy to assert.

| # | Thing | Detail |
|---|---|---|
| 1 | employee `owner` | owner role, all permissions |
| 2 | employee `member` | employee role, member of the public project and one channel |
| 3 | employee `outsider` | employee role, member of nothing |
| 4 | document `Zarquon Closing Procedure` | private, owned by `owner` |
| 5 | document `Zarquon Public Notice` | `visibility = 'public'` |
| 6 | document `Zarquon Denied Notice` | public, **plus** an explicit `access_level = 'none'` employee grant to `member` |
| 7 | file `zarquon-invoice-august.pdf` | uploaded to a private channel `owner` and `member` are in |
| 8 | task `Restock the zarquon freezer` | in a public project |
| 9 | task `Secret zarquon audit` | in a private project only `owner` is a member of |
| 10 | ritual instance `Zarquon opening checklist` | `task_kind = 'ritual_instance'`, public project |
| 11 | task `Archived zarquon cleanup` | in an **archived** project |
| 12 | event `Quarterly zarquon stocktake` | `visibility = 'org_wide'` |
| 13 | event `Zarquon private review` | `visibility = 'private'`, organised by `owner`, no attendees |
| 14 | event `Zarquon cancelled offsite` | `visibility = 'org_wide'`, `cancelled_at` set |
| 15 | channel `#zarquon-ops`, message containing `zarquon` | public channel |
| 16 | department `Zarquon Logistics` | — |
| 17 | employee `Zarquon Nguyen` | — |
| 18 | document `Quy trình đóng cửa zarquon` | Vietnamese title, public |

---

## Backend integration scenarios

```
TestFederatedSearch
```

### US1 — find the thing by typing its name

```
// FR-001, FR-002, FR-003, FR-013
when the owner searches a word that matches in every source
  it returns a Document hit for the closing procedure                       // US1 AC1
  it returns a Work item hit for the freezer task, naming its project       // US1 AC2
  it returns an Event hit for the stocktake, carrying its start date        // US1 AC3
  it returns a File hit for the invoice, naming where it was uploaded       // US1 AC4
  it returns Person, Department, Channel and Message hits alongside them
  every hit carries a title, a context line and a target that identifies it // FR-003
  the Document hit carries a slug, not only an id                           // FR-003, R11
  the Work item hit carries both a project id and a task id                 // FR-003, R11
  running the identical request twice returns the identical order           // FR-013, SC-007
```

### US2 — nothing in the list is a door I cannot open

```
// FR-007: documents
when the outsider searches a word from a private document's title
  it returns no Document hit for it                                          // US2 AC1
  it returns no snippet of that document's content                           // US2 AC1
when the member searches and a public document carries an explicit 'none' grant for them
  it returns no Document hit for that document                               // FR-007, precedence
when the member searches and a document is public with no grant against them
  it returns a Document hit for it
when the owner searches for a document they own privately
  it returns a Document hit for it

// FR-009: work items
when the outsider searches a word from a private project's task title
  it returns no Work item hit for it                                         // US2 AC2
  no outcome count discloses that a matching item was withheld               // FR-009
when the member searches a word matching a public project's task
  it returns a Work item hit for it
when anybody searches a word matching a task in an archived project
  it returns no Work item hit for it                                         // edge case

// FR-008: events
when the member searches a word from a private event they neither organise nor attend
  it returns no Event hit for it                                             // US2 AC3
when the organiser searches that same private event
  it returns an Event hit for it                                             // FR-008
when an attendee searches a personal_shared event they attend
  it returns an Event hit for it                                             // FR-008
when anybody searches a word matching a cancelled event
  it returns no Event hit for it                                             // FR-008, edge case

// FR-010: files
when the outsider searches the filename of a file in a channel they are not in
  it returns no File hit for it                                              // US2 AC4
when a channel member searches that filename
  it returns a File hit for it

// FR-011: the four existing sources are unchanged
when the same query is run against SearchEmployees, SearchDepartments, SearchChannels and
SearchMessages directly and through federated search
  the person, department, channel and message hits are the same set          // FR-011

// SC-003 / US2 AC5: nothing in the list refuses on open
for every hit returned to every fixture caller
  fetching its target by its identifiers succeeds                            // SC-002, SC-003
```

### US3 — the search box does not half-fail in silence

```
// FR-004, FR-005, FR-012
when every source is healthy
  every one of the eight outcomes is OK                                      // FR-004
when a source is made to fail
  the response still contains hits from every other source                   // FR-005, US3 AC1
  that source's outcome is UNAVAILABLE with a non-empty detail               // FR-004, US3 AC1
  the other seven outcomes are still OK
when a source is made to exceed its deadline
  the search returns without waiting for it                                  // FR-006, US3 AC2
  that source's outcome is UNAVAILABLE
  the elapsed time is below the overall budget                               // FR-006, SC-004
when every source fails
  the call returns Unavailable rather than an empty successful response      // US3 AC3, SC-005
when a source returns nothing but succeeds
  its outcome is OK with hit_count zero, not UNAVAILABLE                     // FR-004

// FR-012: permissions are a skip, not a failure
when a caller without docs.view searches
  the call succeeds                                                          // FR-012
  the document outcome is NOT_PERMITTED, not UNAVAILABLE                     // FR-012, edge case
  every other source still answers                                           // FR-012
when a caller permitted to search nothing at all searches
  the call succeeds with an empty list and eight NOT_PERMITTED outcomes      // R14, edge case
```

### US4 — narrow to one kind

```
// FR-015, FR-014, FR-016
when the owner searches with no kind filter
  no source contributes more than the per-source cap                         // FR-014
  a single matching document appears within the first eight hits even against a hundred
  matching messages                                                          // FR-014, SC-006
  the total number of hits never exceeds the maximum                         // FR-016
when the owner searches narrowed to documents
  every hit is a Document hit                                                // US4 AC1, FR-015
  more documents are returned than the mixed list contained                  // US4 AC1, FR-015
when the owner searches narrowed to documents with an over-large limit
  the returned count is clamped to the narrowed maximum                      // FR-016
```

### Edge cases

```
when the query is one character
  the call returns InvalidArgument                                           // edge case, R15
when the query matches nothing anywhere
  the call succeeds with zero hits and eight OK outcomes                     // edge case
when a Vietnamese title is searched in Vietnamese
  it returns the Document hit for it                                         // SC-008
when a ritual instance and an ordinary task both match
  both are Work item hits and each says which it is                          // edge case
```

---

## Web E2E scenarios — `frontend/apps/web/e2e/federated-search.spec.ts`

```
describe federated search results page
  it shows Document, File, Work item and Event rows alongside the existing four  // FR-018
  it shows a category tab per kind with a result count                           // FR-018
  it narrows to one kind when a tab is clicked and keeps the narrowing when the
     query changes                                                                // FR-018, US4 AC2
  it names the unavailable kind when one source fails                            // FR-004, US3 AC1
  it opens the document when a Document row is clicked                           // FR-017-equivalent
  it opens the task at its project-scoped route when a Work item row is clicked
  it reports that an item is gone rather than showing a blank screen when its
     target was deleted after the search                                          // FR-022, edge case
  it keeps the search box as the only entry point                                // FR-020
```

## Mobile scenarios — `frontend/apps/mobile/.maestro/federated-search.yaml`

One happy-path flow, per the deliberately lighter mobile bar:

```
open the app -> tap the search pill -> type the distinctive word ->
  see a Document row, a Work item row, an Event row and a File row ->
  tap the Document row -> the document opens ->
  go back -> the document is offered as a recent item          // FR-017, FR-020, FR-021
```

Manual verification required alongside the flow, because Maestro cannot assert layout:
the results list renders correctly at **360 dp on Android** as well as on iOS, with all
eight row kinds present and none clipped or overlapping (SC-010, Principle XIII).

---

## Documented exclusions

| Requirement | Excluded from | Justification |
|---|---|---|
| **FR-017** (mobile renders and opens all eight kinds) | backend integration | Not observable from an RPC client. Covered by the Maestro flow for the happy path and by manual 360 dp verification for the rest; the *data* half — that every kind's target identifiers are present and resolvable — is asserted backend-side by "fetching its target by its identifiers succeeds". |
| **FR-019** (a row with nowhere to go says so) | backend integration; Maestro | A UI-only affordance, and after this feature every kind has somewhere to go on both platforms, so it is a defensive branch rather than a reachable path. Verified by inspection. |
| **FR-020** (no new entry point) | backend integration | Absence of a UI element. Asserted in the web E2E suite; on mobile it is the existing `SearchPill` and is unchanged. |
| **FR-021, FR-022** (recent items) | backend integration | Recents are device-local MMKV and never reach the server (spec assumption). FR-021 is covered by the Maestro flow; FR-022 is covered by the web E2E deleted-target scenario and, on mobile, by inspection of the eviction branch. |
| **FR-023, FR-024** (documentation) | all automated suites | Documentation requirements. Verified in review against `docs/domain/workspace-navigation.md`, `docs-knowledge.md`, `calendar.md` and the drift register in `docs/domain/README.md`. |
| **SC-004** (p95 < 1 s at realistic volume) | integration assertions beyond the deadline check | The suite asserts the *deadline* behaviour — that a slow source does not block the answer — which is the part that is deterministic. A p95 figure needs a realistic corpus and repeated runs; it is a measurement to take against a seeded workspace, recorded in `quickstart.md`, not a pass/fail unit in CI. |
| **SC-010** (360 dp on Android and iOS) | automated suites | Layout, not behaviour. Manual verification on both platforms, called out above because the habitual test device is an iPhone SE and narrow-Android regressions otherwise go unnoticed. |
