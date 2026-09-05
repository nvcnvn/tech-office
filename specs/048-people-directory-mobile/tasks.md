# Tasks: People Directory on Mobile

**Input**: Design documents from `/specs/048-people-directory-mobile/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [quickstart.md](quickstart.md),
[contracts/iam-directory.proto](contracts/iam-directory.proto)

**Tests**: Test tasks are included. Constitution II requires scenario-first testing, FR-023
requires two blackbox device flows, and [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii)
already fixes the `t.Run` scenario tree as this feature's behavioural contract.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested
and demoed on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 — maps to the user stories in [spec.md](spec.md)
- Every task names the exact file it touches

## Path Conventions

Monorepo, existing packages only. Backend Go under `backend/`, mobile Expo app under
`frontend/apps/mobile/`, shared API wrappers under `frontend/packages/apis/`. **No new
package, no new service, no migration.**

---

## Phase 1: Setup (Contract & Codegen)

**Purpose**: Land the wire contract and the query so both sides of the stack can be built
against generated types rather than hand-written ones.

- [X] T001 Append the `ListDirectory` rpc (with `option (rpc.v1.access_control) = { required_permissions: ["iam.listEmployees"] }`) and the three messages `ListDirectoryRequest`, `DirectoryEntry`, `ListDirectoryResponse` to `backend/rpc/v1/iam.proto`, copying field numbers, `optional` markers and comments verbatim from `specs/048-people-directory-mobile/contracts/iam-directory.proto`. Remove and rename nothing.
- [X] T002 Add `-- name: ListDirectoryEntries :many` to `backend/database/scripts/iam.query.sql` per [data-model.md](data-model.md#query-contract): select `id, given_name, family_name, email, phone_number, department_id, department_name` from `organization.employee e` LEFT JOIN `organization.department_member dm` ON `(dm.organization_id, dm.employee_id) = (e.organization_id, e.id)` LEFT JOIN `organization.department d` ON `(d.organization_id, d.id) = (dm.organization_id, dm.department_id)`; predicates `e.organization_id = @organization_id AND e.is_active = true`; nullable filters `sqlc.narg(employee_ids)::uuid[]`, `sqlc.narg(department_id)::uuid` as an `EXISTS` subquery, and the three-part cursor `sqlc.narg(cursor_family)::text`, `sqlc.narg(cursor_given)::text`, `sqlc.narg(cursor_id)::uuid`; `ORDER BY lower(e.family_name), lower(e.given_name), e.id LIMIT @page_size`.
- [X] T003 Run `cd backend && buf generate && sqlc generate` and commit the regenerated `backend/rpc/v1/*.pb.go`, `backend/database/iam.query.sql.go` and `frontend/packages/rpc/` output. Do **not** run `backend/scripts/regen-schema.sh` — there is no migration and `backend/database/scripts/schema.sql` is a generated snapshot that must never be hand-edited.
- [X] T004 Run `make lint-tenancy` and confirm it is green with no `-- lint:cross-tenant` marker added — `ListDirectoryEntries` is a tenant-scoped read and both joins carry `organization_id` in the join condition.

**Checkpoint**: Generated Go and TypeScript types for `ListDirectory` exist; nothing calls them yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one RPC, its logic layer, its API wrapper and the shared row component
that all three user stories consume.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Backend

- [X] T005 Declare the consumer-side `EmployeeSearcher` interface (one method: `SearchEmployees(ctx, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchEmployeesRow, error)`), add `ListDirectory` to the `IAMLogic` interface, and add a `SetEmployeeSearcher(EmployeeSearcher)` setter plus the backing field on `iamLogicImpl` in `backend/internal/iam/logic.go`. A setter, not a constructor argument, because `internal/organization` imports `internal/iam` (a direct import would be a cycle) and because it leaves the `NewIAMLogic` call sites in `backend/cmd/seed_demo.go` and `backend/integration/` untouched.
- [X] T006 Wire `iamLogic.SetEmployeeSearcher(orgLogic)` in `backend/cmd/server.go` immediately after `orgLogic` and `iamLogic` are constructed (currently lines 153–154), beside the existing `orgLogic.SetCollaborationLogic` / `collaborationLogic.SetEmployeeNameLookup` setters.
- [X] T007 Create `backend/internal/iam/directory_logic.go` holding: page-size clamping (0 → 50, max 100, min 1), the `employee_ids` cap of 100, opaque base64 cursor encode/decode over `family_name \x1f given_name \x1f id`, the browse path (`ListDirectoryEntries`), the narrow path (delegate to `EmployeeSearcher.SearchEmployees` carrying the caller's `tx`, then enrich by `employee_ids` and re-order the enriched rows to the matcher's id sequence), the batch merge of `GetRoleNamesForEmployeeBatch` and `GetLatestEmployeePresenceByIDs`, the `online_hidden` → `offline` normalisation, empty-string-and-NULL → absent mapping for `email` and `phone_number`, both-or-neither department id/name, and the proto mapping. `next_cursor` is empty for a narrowed request and for an exhausted page.
- [X] T008 Add the thin `ListDirectory` handler to `backend/internal/iam/connect_auth.go`, beside `GetEmployeeCards`: extract `organization_id` and the caller's employee id from the JWT (never from the request), compute `is_self`, open the transaction, delegate to `s.logic`, and `slog.InfoContext` at entry (filters, page size) and on failure. Over-long `employee_ids` and a malformed UUID return `CodeInvalidArgument`; an unknown `department_id` returns an empty page, not an error.
- [X] T009 Create `backend/integration/people_directory_test.go` with `TestPeopleDirectory` driven by `newTestWorld(t)` and the full nested `t.Run` tree from [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii), every leaf `t.Skip("pending")`. Add the fixtures the tree needs: two organizations, a deactivated employee, a de-identified tombstone (`is_active = false`, name stripped, NULL phone), a colleague with a phone number and one without, a colleague with no email, a colleague in no department, a populated department and an empty one, a roster larger than one page, and a caller in a custom role with `iam.listEmployees` removed.

### Frontend

- [X] T010 [P] Create `frontend/packages/apis/src/iam-directory.ts` exporting `listDirectory({ query, departmentId, employeeIds, cursor, pageSize })` and `getDirectoryEntry(employeeId)` (a `listDirectory` call with one id) returning native TypeScript types — not protobuf ones — via the existing `rpcWrapper` pattern used by `iam-employee-list.ts`, and re-export it from `frontend/packages/apis/src/index.ts`. No screen may import `iamClient` directly (Constitution VII).
- [X] T011 [P] Add `people: icon('person.2', 'People', 'menu-people', 'person.2.fill')` to `moreMenuIcons` in `frontend/packages/theme-tokens/src/icons.ts`.
- [X] T012 [P] Create `frontend/apps/mobile/src/components/common/directory-row.tsx` — the row shared by the directory list, the department member list and search-adjacent surfaces: avatar, display name on the primary line (never truncated), department and role sharing the secondary line and truncating first, and a presence dot fed from the `presenceStatus` already on the entry. It must **not** call `useUserProfile` or `usePresence`; the payload already carries every field it renders. `testID={`person-row-${employeeId}`}`, tap target ≥ 44 pt, all colours from `@tech-office/theme-tokens`.

**Checkpoint**: `ListDirectory` answers over the wire, the wrapper and the row exist, the
behavioural contract is written and skipped. User stories can start.

---

## Phase 3: User Story 1 - Look up a colleague and call their phone (Priority: P1) 🎯 MVP

**Goal**: A member opens People from the mobile app, finds a colleague by name, sees their
phone number, and hands it to the device dialer in one tap.

**Independent Test**: Sign in on a device as any member, open More → People, search for a
colleague who has a phone number recorded, confirm the number is displayed and that tapping
it opens the device dialer pre-filled. Fully testable with no department and no messaging
work done.

### Tests for User Story 1

- [X] T013 [P] [US1] Implement the "when a member opens the directory" scenarios in `backend/integration/people_directory_test.go`: it lists the active colleagues of their own organization (FR-001); each entry carries display name, department, role and presence (FR-002); it never returns date of birth, home address or hire date (FR-008); it excludes a deactivated employee and a de-identified deletion tombstone (FR-005); it never returns a person from another organization (FR-021).
- [X] T014 [P] [US1] Implement the "when the roster is larger than one page" scenarios in `backend/integration/people_directory_test.go`: the first page returns without waiting for the whole roster; the cursor walks every person exactly once in name order; an exhausted page returns an empty next cursor (FR-006).
- [X] T015 [P] [US1] Implement the "when the member narrows by name" scenarios in `backend/integration/people_directory_test.go`: a partial name finds the person; a misspelled name still finds the person; a name in a second script finds the person; narrowing searches the whole roster, not one page of it; a narrowed response carries no cursor (FR-004).
- [X] T016 [P] [US1] Implement the contact-field scenarios in `backend/integration/people_directory_test.go`: the entry carries the number as recorded (FR-007); a colleague with no phone number has the field omitted rather than returned as an empty string (FR-012); a colleague with no email omits the email and still names the person; a colleague in no department omits both department id and department name.
- [X] T017 [P] [US1] Implement the guard scenarios in `backend/integration/people_directory_test.go`: a caller lacking `iam.listEmployees` is rejected by the interceptor before the handler runs (FR-019, FR-020); a request naming more than a hundred people is rejected as `InvalidArgument`.

### Implementation for User Story 1

- [X] T018 [US1] Create `frontend/apps/mobile/src/app/(app)/(more)/people/index.tsx` — the directory list: `useInfiniteQuery` on `["directory", null, query]` calling `listDirectory`, rendering `DirectoryRow` in a `FlatList` with `onEndReached` paging on `nextCursor`, and a debounced search input (`testID="people-search-input"`) that switches the same key to the narrowed single page. Tapping a row seeds `["directory-entry", employeeId]` and the shared `userProfileQueryKey(id)` cache via `usePopulateUserCache()` from `frontend/apps/mobile/src/hooks/use-user-profile.ts`, then pushes `/(app)/(more)/people/${employeeId}`. Empty and error states use the existing shared components.
- [X] T019 [US1] Create `frontend/apps/mobile/src/app/(app)/(more)/people/[employeeId].tsx` — the person entry: name, department, role, presence, email row when recorded, and the phone row when recorded. The phone row (`testID="person-phone-row"`, ≥ 44 pt) displays the number with its original formatting and, on tap, calls `Linking.openURL` from `react-native` with a `tel:` URI built by sanitising the number to `+` and digits, inside `try/catch`. **No `Linking.canOpenURL` probe** — on Android 11+ it returns `false` without a manifest `<queries>` entry and would make the row silently do nothing on a real phone (research Decision 7). A rejection shows a plain-language alert and leaves the number on screen (FR-014). When no phone number is recorded, render **nothing** — no disabled button, no "Not provided" (FR-012). Date of birth, home address and hire date are not fields of the response and appear nowhere.
- [X] T020 [US1] Register `people/index` (`title: "People"`, with `childBackOptions`) and `people/[employeeId]` (`title: "Person"`, **without** `childBackOptions` — a person is opened from the directory, a department list or a search result, so the back button belongs to whichever brought you here, following the `docs/[slug]` and `files/[fileId]` precedent) as `Stack.Screen` entries in `frontend/apps/mobile/src/app/(app)/(more)/_layout.tsx`.
- [X] T021 [US1] Add the People menu row to `frontend/apps/mobile/src/app/(app)/(more)/index.tsx`, `href: "/(app)/(more)/people"`, using `moreMenuIcons.people`, gated on `iam.listEmployees` being present in the permission set already cached under `["employee-permissions", employeeId]` (the shape `(app)/(tasks)/index.tsx` uses). A member without the permission must not see the row at all, rather than seeing it and erroring on tap (FR-020).
- [X] T022 [US1] Create `frontend/apps/mobile/.maestro/people/directory-call.yaml` — sign in → More → `menu-people` → type a name into `people-search-input` → tap `person-row-*` → assert `person-phone-row` is visible → tap it, accepting either branch (the app leaves the foreground for the dialer, or FR-014's "could not be started" alert on a simulator with no telephony). Take screenshots into `tmp/maestro-screenshots/`. Add `MAESTRO_DIRECTORY_PERSON_WITH_PHONE` and `MAESTRO_DIRECTORY_PERSON_NO_PHONE` to `frontend/apps/mobile/.maestro/.env.example`.
- [X] T023 [US1] Run `make test-backend-one T=TestPeopleDirectory` and `make test-mobile-one F=people/directory-call`; then walk quickstart manual steps 1, 2 and 6 on a device at **360 dp on Android** and on iOS (FR-024), confirming the name is never truncated to make room for the role.

**Checkpoint**: A member can find a colleague and call them. US1 is a shippable MVP with no
department screen and no Message button.

---

## Phase 4: User Story 2 - Message a colleague from the directory (Priority: P2)

**Goal**: From a colleague's entry, one tap opens the direct-message conversation with them,
creating it if it does not exist. The member's own entry offers neither Message nor Call.

**Independent Test**: Open a colleague in the directory, tap Message, confirm the DM opens
(created on the spot if the two have never spoken). Open your own entry and confirm it leads
to the profile screen with no Message and no Call.

### Tests for User Story 2

- [X] T024 [P] [US2] Implement "it marks the caller's own entry as self" in `backend/integration/people_directory_test.go` — `is_self` is true for exactly the calling employee's row and false for every other, computed from the JWT and never from the request (FR-010).

### Implementation for User Story 2

- [X] T025 [US2] Add the Message action to `frontend/apps/mobile/src/app/(app)/(more)/people/[employeeId].tsx` (`testID="person-message-button"`, ≥ 44 pt): call the existing `createOrGetDirectMessage` from `@tech-office/apis` and navigate to the returned conversation in the same action, with no intermediate step. On failure, show a plain-language alert and stay on the entry with the person still on screen (FR-014) — never drop the member onto an empty screen.
- [X] T026 [US2] Handle the self entry in `frontend/apps/mobile/src/app/(app)/(more)/people/[employeeId].tsx`: when `isSelf` is true, render neither Message nor Call and lead to the existing `/(app)/(more)/profile` screen instead (FR-010). The row for the caller in the directory list likewise routes to profile.
- [X] T027 [US2] Walk quickstart manual step 3 on a device: message a colleague you have never spoken to, then stop the backend and tap Message to see the FR-014 failure path, then open your own entry.

**Checkpoint**: The directory is the place you go to reach somebody — by phone or by chat.
US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Open a department and see its people (Priority: P3)

**Goal**: A department result in mobile search — or the department shown on a person's entry
— opens the list of people in that department. No mobile search result kind is inert.

**Independent Test**: Search for a department by name on mobile, tap the result, confirm a
screen opens naming the department and listing its members; tap a person and confirm their
entry opens.

### Tests for User Story 3

- [X] T028 [P] [US3] Implement the "when the request names a department" scenarios in `backend/integration/people_directory_test.go`: it returns that department's active members and no one else (FR-015); an empty department returns no entries and no error (FR-017); an unknown department id returns no entries and no error (US3-4); a member's own department is still shown on their row, because the department filter is an `EXISTS` rather than the display join (FR-018).

### Implementation for User Story 3

- [X] T029 [US3] Create `frontend/apps/mobile/src/app/(app)/(more)/people/department/[departmentId].tsx` — the department member list: `getDepartment(departmentId)` for the name and `listDirectory({ departmentId })` for the members, issued in the same render so the screen is bounded by the slower call rather than their sum. Rows are the same `DirectoryRow` and behave identically to directory rows (FR-018), `testID="department-members-list"`. A department with no members still names the department and says plainly that nobody is assigned to it yet (`testID="department-empty"`, FR-017). A `NotFound` from `getDepartment` alerts and returns the member to where they were.
- [X] T030 [US3] Register `people/department/[departmentId]` (`title: "Department"`, **without** `childBackOptions`, same reasoning as the person entry) as a `Stack.Screen` in `frontend/apps/mobile/src/app/(app)/(more)/_layout.tsx`.
- [X] T031 [US3] Replace the inert `case "department"` arm in `frontend/apps/mobile/src/app/(app)/(more)/search.tsx` (currently returns `true` with the comment "No department screen exists on mobile yet"): `if (!t.departmentId) return false;` then `await getDepartment(t.departmentId)` and, on `NotFound`, `return false` so the existing generic stale-recent path alerts "This item is no longer available" and calls `removeRecent` — the same eviction every other result kind already gets (US3-4). Otherwise `pushWithBack('/(app)/(more)/people/department/' + t.departmentId)` and `return true`. Leave the `case "person"` arm alone: it opens the conversation today and rerouting it would add a tap to a path that works (research Decision 11). [ASSUMPTION: the stale-recent check is a bounded `getDepartment` call inside `openRow`, which is already `async` for the person arm, rather than letting the department screen discover the deletion after navigating — this reuses the existing eviction mechanism exactly and is what "consistent with every other kind of stale recent" in US3 scenario 4 asks for.]
- [X] T032 [US3] Make the department shown on a person's entry tappable in `frontend/apps/mobile/src/app/(app)/(more)/people/[employeeId].tsx` (`testID="person-department-row"`), opening the same department screen (FR-016).
- [X] T033 [US3] Create `frontend/apps/mobile/.maestro/people/department-members.yaml` — sign in → search a department name → tap the result → assert the department name and a member row → tap the member → assert their entry. Screenshots into `tmp/maestro-screenshots/`. Add `MAESTRO_DIRECTORY_DEPARTMENT` to `frontend/apps/mobile/.maestro/.env.example`.
- [X] T034 [US3] Run `make test-mobile-one F=people/department-members` and walk quickstart manual step 4, including the empty department and the deleted-department recent.

**Checkpoint**: All three stories are independently functional and no mobile search result
kind is inert (SC-003).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The living-documentation duty (Constitution XII), the regression guards, and
the design checklist.

- [X] T035 [P] Update `docs/domain/organization-people.md`: the mobile client-surfaces bullet currently says "no ongoing org-admin surface — people appear through chat member lists, task assignees and presence", which this feature makes untrue. Add the read-only directory, add `ListDirectory` beside `ListEmployees` / `GetEmployeeCards` with its narrower field set, note that date of birth, home address and hire date are withheld from mobile, and refresh the status date.
- [X] T036 [P] Update `docs/domain/workspace-navigation.md`: the department search result on mobile now opens a member list; delete the "Department informational (mobile has no department screen)" statement rather than leaving it beside the new one, and refresh the status date.
- [X] T037 [P] Add a drift-register row to `docs/domain/README.md` for the missing trigram index on `organization.employee.email` — `SearchEmployees`' email leg is a sequential scan because `iam.idx_identity_email_trgm` covers `iam.identity.email`, which the query no longer reads. Found while checking research Decision 3; deliberately not fixed here.
- [X] T038 [P] Record the new `iam → organization` logic-layer edge (`EmployeeSearcher`, injected in `cmd/server.go`) in the code-level dependency graph of `backend/docs/SYSTEM-ARCHITECTURE.md`, beside the existing consumer-declared interfaces for `chat`, `voice` and `iam`.
- [X] T039 Confirm no `t.Skip` remains in `backend/integration/people_directory_test.go` and run the entire backend suite as a regression guard: `cd backend && go test ./integration/...`.
- [X] T040 Run the entire web E2E suite as a regression guard. No new specs are added — this feature has no web surface (documented exclusion in [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii)).
- [X] T041 Run the entire Maestro suite (`make test-mobile`), including the two new flows.
- [X] T042 Walk the mobile design checklist in [quickstart.md](quickstart.md#mobile-design-checklist-constitution-xiii): three taps to a colleague's number, single-column portrait layout, every `testID` present (`menu-people`, `people-search-input`, `person-row-<employeeId>`, `person-phone-row`, `person-message-button`, `person-department-row`, `department-members-list`, `department-empty`), tap targets ≥ 44 pt, no hardcoded colours, and verification at 360 dp on **Android** as well as iOS.
- [X] T043 Confirm FR-022 by grepping `frontend/apps/mobile/package.json` for `expo-contacts` and any new storage: the feature must add no dependency and no store of its own, inheriting offline readability from the existing MMKV persistence in `frontend/apps/mobile/src/lib/query-client.ts`. Verify SC-006 with quickstart manual step 5 (airplane mode).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001 → T003, T002 → T003, T003 → T004.
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks all user stories**.
- **User Stories (Phase 3–5)**: all depend on Phase 2. US1 → US2 → US3 in priority order,
  or in parallel across developers once Phase 2 is done.
- **Polish (Phase 6)**: depends on every story being complete.

### User Story Dependencies

- **US1 (P1)**: independent. Ships alone as the MVP.
- **US2 (P2)**: independent of US3. Shares the person entry file with US1 (T019 → T025,
  T026), so it follows US1 in practice rather than by requirement.
- **US3 (P3)**: independent of US2. Shares the person entry file with US1 (T019 → T032)
  and `_layout.tsx` with US1 (T020 → T030).

### Within Each User Story

- Backend scenario stubs exist from T009; each story implements its own leaves.
- Logic before handler, handler before screen, screen before Maestro flow.

### Parallel Opportunities

- T010, T011, T012 — three different files, no dependency between them.
- T013–T017 — five independent scenario groups in one test file; run them as separate
  edits if the file is split by group, otherwise serialise the writes and parallelise
  nothing but the thinking.
- T035–T038 — four different documents.
- Once Phase 2 lands, US1, US2 and US3 can be staffed in parallel; the only contention is
  `people/[employeeId].tsx` (US1, US2, US3) and `_layout.tsx` (US1, US3).

---

## Parallel Example: Phase 2 frontend

```bash
Task: "Create frontend/packages/apis/src/iam-directory.ts wrappers + index re-export"
Task: "Add moreMenuIcons.people to frontend/packages/theme-tokens/src/icons.ts"
Task: "Create frontend/apps/mobile/src/components/common/directory-row.tsx"
```

## Parallel Example: Phase 6 documentation

```bash
Task: "Update docs/domain/organization-people.md"
Task: "Update docs/domain/workspace-navigation.md"
Task: "Add the email trgm drift row to docs/domain/README.md"
Task: "Add the iam → organization edge to backend/docs/SYSTEM-ARCHITECTURE.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — proto, query, codegen, tenancy lint.
2. Phase 2: Foundational — the RPC, the wrapper, the row. **Blocks everything.**
3. Phase 3: US1 — directory list, person entry, dialer hand-off, menu row.
4. **STOP and VALIDATE**: quickstart manual steps 1, 2 and 6 on Android at 360 dp and on
   iOS. At this point the stated pain is gone — an owner can read and dial a worker's
   number from their phone.

### Incremental Delivery

1. Setup + Foundational → the RPC answers.
2. + US1 → find a colleague, see the number, call them. **MVP, shippable.**
3. + US2 → message them without going back to Chat.
4. + US3 → department results stop being dead ends (SC-003).
5. + Polish → the documentation duty and the three full regression suites.

### Parallel Team Strategy

Phase 1 and Phase 2 are one person's work — they are a contract and its single
implementation, and splitting them costs more in coordination than they take to write.
After the Phase 2 checkpoint:

- Developer A: US1 (the MVP; the largest phase)
- Developer B: US3 (touches search and the department screen, barely overlaps A)
- US2 is three small tasks in a file US1 owns; fold it into A rather than staffing it.

---

## Notes

- **Zero migrations, zero permissions, zero write paths.** If a task seems to need a new
  table, index, permission or mutation, the design has been misread — re-read
  [research.md](research.md).
- The single most important line in the feature is `e.is_active = true`: it keeps both
  deactivated colleagues and de-identified deletion tombstones out of a list of people you
  can call. A directory that lists tombstones offers "Deleted user" as somebody to dial.
- Two behaviours are **absences done right** and are the likeliest things to get wrong:
  presence must ride inside the payload rather than through `usePresence` (which is one RPC
  per row, 500 requests on a 500-row list), and a missing phone number must render nothing
  at all — a greyed-out button or a "Not provided" placeholder that invites a tap is
  exactly the failure FR-012 names.
- No "+N more department" affordance is built: `idx_one_department_per_employee` is a
  UNIQUE index on `(organization_id, employee_id)`, so the multi-department state the
  spec's edge case describes cannot exist (research Decision 5).
- `[P]` tasks touch different files. Commit after each task or logical group. Stop at any
  checkpoint to validate a story on its own.
