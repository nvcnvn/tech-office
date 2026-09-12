---
description: "Task list for 056 — Report and Block Wherever User Content Appears"
---

# Tasks: Report and Block Wherever User Content Appears

**Input**: Design documents from `/specs/056-report-block-surfaces/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/surface-controls.md](contracts/surface-controls.md), [contracts/test-scenarios.md](contracts/test-scenarios.md), [quickstart.md](quickstart.md)

**Tests**: INCLUDED. Constitution Principle II makes the behavioural scenarios in
`contracts/test-scenarios.md` the reviewable contract for this plan; the stub names there
are written before implementation and no stub may remain skipped when the feature is done.

**Organization**: Tasks are grouped by user story so each is independently implementable
and testable. US1–US4 are fully independent of each other; only Phase 2 blocks them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1…US4)
- Every task names the exact file it touches

## Path Conventions

Web + mobile clients against an unchanged Go backend:

- Mobile: `frontend/apps/mobile/src/`, flows in `frontend/apps/mobile/.maestro/`
- Web: `frontend/apps/web/src/`, E2E in `frontend/apps/web/e2e/`
- Shared API wrappers: `frontend/packages/apis/src/`
- Backend tests only: `backend/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand the stack up and re-confirm the plan's central claim before writing code

- [X] T001 Bring the local stack up per [quickstart.md](quickstart.md) §Prerequisites: `make dev-up`, `make migrate`, `make dev-backend`, then `cd backend && go run ./cmd seed-demo-org --subdomain demo` for a two-person demo workspace with content
- [X] T002 Re-verify research [R-1](research.md) at HEAD before any code: confirm `backend/internal/compliance/resolvers.go` registers the `file` and `document_comment` resolvers and that `backend/cmd/server.go` wires all four getters into `complianceLogic.RegisterResolvers(...)`. If either is missing, STOP and surface it — the spec's closing assumption and FR-022 are broken

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one API-wrapper repair US1 depends on, and the shared block predicate US1 must mirror rather than fork

**⚠️ CRITICAL**: T003–T005 must complete before User Story 1 begins. US2, US3 and US4 do not depend on this phase and may start immediately after Phase 1.

- [X] T003 Fix `getMessageById` in `frontend/packages/apis/src/chat.ts` (currently a bare `as GetMessageByIdResponse` cast at ~line 711): map the response's `channel` through the existing `convertChannelType()` helper in the same file, and declare the return shape as `{ message: Message; channel: { id: string; channelType: ChannelType; displayName: string } | null; isMember: boolean }` per [data-model.md](data-model.md). Breaking change to the wrapper's return type, shipped atomically (research [R-2](research.md), Principles VI/VII/VIII)
- [X] T004 Typecheck both callers of `getMessageById` against the new shape — `frontend/apps/web/src/app/workspace/chat/page.tsx` (~line 99) and the two queries in `frontend/apps/mobile/src/app/(app)/(chat)/thread/[messageId].tsx` (~lines 526, 570). Both read only `channel.id` and `message.*`, so expect no adaptation; run the frontend typecheck to prove it rather than assuming
- [X] T005 Correct the block predicate in `frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx` (~line 2319): `canBlockAuthor` becomes `selectedMessage?.messageKind !== "system" && !!selectedMessage?.authorEmployeeId && selectedMessage.authorEmployeeId !== auth.employeeId`. System rows carry the acting employee in `author_employee_id`, so today a channel system row wrongly offers "Block this person" (research [R-4](research.md), FR-003). Matches the neighbouring `canCreateTask={selectedMessage?.messageKind !== "system"}` at ~line 2338

**Checkpoint**: The thread screen can read a mapped `ChannelType`, and the block rule it must mirror is correct on the screen it mirrors.

---

## Phase 3: User Story 1 - Report a message inside a thread (Priority: P1) 🎯 MVP

**Goal**: Long-pressing the thread's parent card or any reply offers the same Report and Block actions, worded identically, as the channel timeline — and a report from a thread inside a direct conversation records `direct_message`.

**Independent Test**: Open any thread, long-press a reply written by somebody else, tap Report, tap a reason, see the confirmation. Three presses. Nothing else in this feature need exist.

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before implementing.

- [X] T006 [P] [US1] Add the FR-002 scenario group to `backend/integration/compliance_report_test.go` under `TestContentReporting`, using the stub names from [contracts/test-scenarios.md](contracts/test-scenarios.md) §1: `"when a person reports a reply inside a direct conversation's thread"` → `"it is recorded with the direct-message target kind"`. Arrange with the existing `replyToMessage` helper on a direct conversation
- [X] T007 [P] [US1] Add `frontend/apps/mobile/.maestro/compliance/report-thread-message.yaml` mirroring the existing `report-message.yaml`, one screen deeper: sign in → open a channel → post a probe message → open its thread → post a reply → long-press the reply → `message-action-report` → `report-reason-harassment` → assert `report-sheet-confirmation`. Post its own message and reply so it is deterministic in a shared simulator account; carry the same explanatory header `report-message.yaml` uses. Also assert that long-pressing **its own** reply shows no `message-action-block` (FR-003)

### Implementation for User Story 1

- [X] T008 [US1] Widen the local `ThreadReply` interface (and the parent-message shape) in `frontend/apps/mobile/src/app/(app)/(chat)/thread/[messageId].tsx` to carry `authorEmployeeId: string` and keep `messageKind: string`, per [data-model.md](data-model.md). No new fetch — both fields are already in the responses the screen holds
- [X] T009 [US1] In the same file, derive `reportTargetKind = parentChannel.channelType === 'direct_message' ? 'direct_message' : 'chat_message'` from the now-mapped `getMessageById(...).channel.channelType` (FR-002). Depends on T003
- [X] T010 [US1] In the same file, add the Report and Block rows to `ThreadMessageActionSheet` with `testID`s `message-action-report` and `message-action-block`, copying the channel sheet's copy **verbatim** per [contracts/surface-controls.md](contracts/surface-controls.md) §Copy: "Report this message" / "Tell the people who run this workspace that something here is wrong." and "Block this person" / "Stop them starting a direct conversation or calling you. They are not told." Duplicate the rows rather than extracting a shared component (research [R-3](research.md))
- [X] T011 [US1] In the same file, gate the Block row on the Phase 2 predicate — `messageKind !== 'system' && !!authorEmployeeId && authorEmployeeId !== auth.employeeId` — identical to `[channelId].tsx` after T005 (FR-003). The Report row is offered unconditionally, including on system rows
- [X] T012 [US1] In the same file, mount the existing `ReportSheet` (from `src/components/compliance/report-sheet.tsx`) with `subjectLabel="this message"` and the derived `targetKind`, and the existing `BlockConfirm` (from `src/components/compliance/block-confirm.tsx`), driven from the selected-message state. One sheet instance serves both the parent card and every reply (FR-001, FR-018). No new form component
- [X] T013 [US1] Confirm `frontend/apps/mobile/src/app/(app)/(shared)/resource/chat/thread/[messageId].tsx` re-exports the edited screen so the "every route that shows a thread" half of FR-001 needs no second edit; if it does not re-export, make it do so rather than duplicating the screen
- [X] T014 [US1] Make T006 and T007 pass: `make test-backend-one T=TestContentReporting` and `make test-mobile-one F=compliance/report-thread-message`. Then walk [quickstart.md](quickstart.md) §2a–2e by hand on **both Android and iOS**, including §2d — a system row in a channel must no longer offer Block

**Checkpoint**: US1 is fully functional and independently testable. This is the MVP.

---

## Phase 4: User Story 2 - Stop contact from a person's profile (Priority: P2)

**Goal**: A colleague's profile offers Block, or Unblock if already blocked, and flips in place after confirming — without the person hunting for a message first.

**Independent Test**: Open a colleague in the people directory, tap Block, confirm, see the control become Unblock without leaving the screen. Nothing else in this feature need exist.

**Note**: No backend scenario is added here. `backend/integration/compliance_block_test.go` already covers recording, silence (FR-010/SC-005), symmetry, idempotence and unblock — a block from a profile is byte-identical to one from a message. This exclusion is the Principle II justified exclusion recorded in [plan.md](plan.md).

### Tests for User Story 2 ⚠️

- [X] T015 [P] [US2] Add `frontend/apps/mobile/.maestro/compliance/block-from-profile.yaml`: sign in → **More → People** → open a colleague who is not the signed-in person → assert `person-block-button` visible → tap → assert the `block-confirm` scope wording (direct conversations and calls stop; shared channels unaffected) → confirm → assert `person-unblock-button` is visible **without navigating away** (that assertion is FR-008) → then unblock, to leave the shared simulator account as it was found

### Implementation for User Story 2

- [X] T016 [US2] In `frontend/apps/mobile/src/app/(app)/(more)/people/[employeeId].tsx`, add `useQuery({ queryKey: ["compliance", "blocked-people"], queryFn: listBlockedPeople, staleTime: 60_000 })` — the **same** key the channel screen and `(more)/blocked.tsx` use, so one invalidation settles every mounted screen (research [R-5](research.md), FR-008)
- [X] T017 [US2] In the same file, derive `contactControl`: `undefined` while the query is unresolved, then `'none'` if the entry is the signed-in person, `'unblock'` if the entry's `employeeId` is in the blocked list, else `'block'` (FR-005–FR-007 and the "block list not loaded yet" edge case). Render nothing while `undefined` — never guess-then-flip
- [X] T018 [US2] In the same file, render the Block / Unblock button under the profile header with `testID`s `person-block-button` and `person-unblock-button` per [contracts/surface-controls.md](contracts/surface-controls.md) rows 11–12. Mutually exclusive; neither on the signed-in person's own entry; the existing "Open your profile" button is unaffected
- [X] T019 [US2] In the same file, mount the existing `BlockConfirm` from `src/components/compliance/block-confirm.tsx` for the block path and call the existing unblock path for the unblock button, invalidating `["compliance","blocked-people"]` in `onDone` so the control flips in place (FR-008, FR-009). No second block confirmation (FR-018)
- [X] T020 [US2] Make T015 pass: `make test-mobile-one F=compliance/block-from-profile`, then walk [quickstart.md](quickstart.md) §2f by hand on **both Android and iOS**, including the own-entry case, and §7 (sign in as the blocked person and confirm nothing tells them)

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Report an uploaded file (Priority: P3)

**Goal**: A file can be reported from the mobile list row, the mobile detail screen and the web files table, and the form calls its subject "this file".

**Independent Test**: Open the mobile files list, report a file, see the confirmation; open a file's detail screen and report from there; report a row on the web files page.

### Tests for User Story 3 ⚠️

- [X] T021 [P] [US3] Add the `seedFile` helper to `backend/integration/helper_test.go`: `func (w *testWorld) seedFile(uploader testUser, filename string) string`, inserting a `files.file_metadata` row directly the way `voice_communication_test.go` seeds call artifacts — a real upload needs object storage the integration suite does not run
- [X] T022 [US3] Add the file scenario group to `backend/integration/compliance_report_test.go` with the stub names from [contracts/test-scenarios.md](contracts/test-scenarios.md): `"when a person reports an uploaded file"` → `"it is recorded with the file target kind"`, `"the reported author is the person who uploaded it"`, `"the snapshot names the file rather than quoting a message"`, `"it appears in the owner's report queue alongside message reports"`. Depends on T021
- [X] T023 [US3] Add the deleted-file refusal group to the same file: `"when a person reports a file that no longer exists"` → `"it is refused as a target that could not be found"`, `"the refusal carries the target-not-found reason, not a raw error"` — asserting the `COMPLIANCE_REPORT_TARGET_NOT_FOUND` reason, not message text (FR-019, Principle X, US3 acceptance 5). Depends on T021
- [X] T024 [P] [US3] Extend `frontend/apps/web/e2e/compliance-report.spec.ts` with `test.describe('when a person reports a file from the files page')` → `'the row offers a report control and the dialog names the file'`, `'the report is recorded against the file and reaches the owner queue'`. Arrange the file through `e2e/helpers/api.ts`; act and assert through the browser
- [X] T025 [P] [US3] Add `frontend/apps/mobile/.maestro/compliance/report-file.yaml`: sign in → **More → Files** → tap the report control on the first row → choose a reason → assert the confirmation

### Implementation for User Story 3

- [X] T026 [P] [US3] In `frontend/apps/mobile/src/app/(app)/(more)/files/index.tsx`, add a secondary `Report` `Button` beside the existing `Download` button in each row card's `fileActions` row, a `testID` of `file-report-<fileId>`, driving a single `reportFileId` state; mount one `ReportSheet` with `targetKind="file"` and `subjectLabel="this file"` (research [R-6](research.md), FR-012, FR-015)
- [X] T027 [P] [US3] In `frontend/apps/mobile/src/app/(app)/(more)/files/[fileId].tsx`, add the same `Report` button beside `Download` in the `actions` row with `testID="file-detail-report"` and mount `ReportSheet` the same way. Offered even while the file's safety check is pending (FR-013, spec edge case)
- [X] T028 [P] [US3] In `frontend/apps/web/src/app/workspace/files/components/ManagementTab.tsx`, add a flag `IconButton` to each row's Actions cell beside the existing delete button, a `data-testid` of `file-report-btn-<fileId>`, opening the existing `ReportContentDialog` from `workspace/components/ReportContentDialog.tsx` with `targetKind="file"` and `subjectLabel="this file"` (research [R-7](research.md), FR-014). No new dialog
- [X] T029 [US3] Make T022–T025 pass: `make test-backend-one T=TestContentReporting`, `make test-frontend-one F=compliance-report.spec.ts`, `make test-mobile-one F=compliance/report-file`. Walk [quickstart.md](quickstart.md) §2g on **both Android and iOS** — the two new file controls sit in a row beside an existing button, which is where a narrow Android layout breaks first — and §4b on web

**Checkpoint**: US1, US2 and US3 all work independently.

---

## Phase 6: User Story 4 - Report a document comment (Priority: P4)

**Goal**: A comment written by somebody else in the web comments panel offers Report, and the dialog calls its subject "this comment".

**Independent Test**: Open a document with comments on web, report one comment, see the confirmation.

### Tests for User Story 4 ⚠️

- [X] T030 [P] [US4] Add the document-comment scenario group to `backend/integration/compliance_report_test.go`: `"when a person reports a document comment"` → `"it is recorded with the document-comment target kind"`, `"the reported author is the person who wrote the comment"`, `"the snapshot is the comment text as it stood"`. Arrange with the existing `createDocument` and `addDocumentComment` helpers in `helper_test.go`
- [X] T031 [P] [US4] Extend `frontend/apps/web/e2e/compliance-report.spec.ts` with `test.describe('when a person reports a document comment')` → `'the comment offers a report control and the dialog names the comment'`, `'choosing a reason files the report and confirms'`, `'the report appears in the owner queue with the comment text as its snapshot'`; and `test.describe('when a person opens the actions on their own comment')` → `'no report control is offered'`. Arrange document and comment via `e2e/helpers/api.ts`

### Implementation for User Story 4

- [X] T032 [US4] In `frontend/apps/web/src/app/workspace/docs/components/CommentsPanel.tsx`, add a flag `IconButton` to each comment's actions with a `data-testid` of `comment-report-<commentId>`, shown only when `comment.authorEmployeeId !== user.membershipId` (research [R-8](research.md), FR-016), opening the existing `ReportContentDialog` with `targetKind="document_comment"` and `subjectLabel="this comment"` (FR-017)
- [X] T033 [US4] Make T030 and T031 pass: `make test-backend-one T=TestContentReporting` and `make test-frontend-one F=compliance-report.spec.ts`. Walk [quickstart.md](quickstart.md) §4a by hand, including the own-comment case

**Checkpoint**: Every surface in [contracts/surface-controls.md](contracts/surface-controls.md) has its control. SC-001's count of surfaces missing a control is zero.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The refusal path, the documentation Principle XII and SC-004 require, and the whole-suite gates

- [X] T034 [P] Add the FR-019 refusal scenario to `frontend/apps/web/e2e/compliance-report.spec.ts`: `test.describe('when a person reports something they have already reported')` → `'the dialog stays open and states that it is already reported'`. Asserts existing behaviour (research [R-9](research.md)) — no code should be needed; if the dialog closes or swallows the refusal, that is a bug to fix in `ReportContentDialog.tsx`
- [X] T035 [P] Update `docs/compliance/reviewer-notes.md` to name **every** surface a reviewer can report from — channel message, thread parent and reply, mobile file list and file detail, web files page, web document comment — and to say that blocking is reachable from a person's profile (SC-004, research [R-11](research.md)). Anything the notes claim must actually be doable in one session
- [X] T036 [P] Update `docs/domain/compliance-safety.md` with the per-surface control map from [contracts/surface-controls.md](contracts/surface-controls.md), replacing any text that describes reporting and blocking without saying where the controls are (Constitution Principle XII, mandatory in this change set)
- [X] T037 [P] Add the drift entry to `docs/domain/README.md`: web still offers no way to *create* a block — it can unblock from settings only — recorded as a known gap, not a follow-up task
- [X] T038 Run the form and confirmation counts from [quickstart.md](quickstart.md) §5: `grep -rl "REPORT_REASON_LABELS" frontend/apps/mobile/src frontend/apps/web/src` must return exactly `components/compliance/report-sheet.tsx` and `workspace/components/ReportContentDialog.tsx`; `grep -rl "blockPerson\|unblockPerson" frontend/apps/mobile/src frontend/apps/web/src` must return exactly `components/compliance/block-confirm.tsx` and `workspace/settings/blocked/page.tsx` (FR-018, SC-003)
- [X] T039 Run [quickstart.md](quickstart.md) §6: `git diff --stat main -- backend/ | tail -5` must show `backend/integration/compliance_report_test.go` and nothing else — no migration, no `.proto`, no `schema.sql`, no permission seed (FR-022). Anything else means the spec's closing assumption broke and needs surfacing before the change lands
- [X] T040 Run [quickstart.md](quickstart.md) §3: sign in on web as the owner, open **Settings → Reported content**, confirm every report filed by hand is listed with the right snapshot and attributed to the content's author; then run the `target_kind` count query and confirm rows for `chat_message`, `direct_message`, `file` and `document_comment`, with `call_record` absent
- [ ] T041 Run the whole of each suite, not only the new tests (Constitution Principle II): `make test-backend`, `make test-frontend`, `make test-mobile`. Zero failures, and no `t.Skip("TODO")` or `test.skip` left behind for this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup. **Blocks US1 only** — T003/T004 are the wrapper US1 reads `channelType` from, and T005 is the predicate US1 mirrors
- **US1 (Phase 3)**: after Phase 2
- **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**: after Phase 1 — independent of Phase 2 and of each other
- **Polish (Phase 7)**: T034 after US3 or US4 exists to report twice against; T035–T037 after the surfaces they document exist; T038–T041 last

### User Story Dependencies

- **US1 (P1)**: depends on Phase 2 (T003, T005). No dependency on US2/US3/US4
- **US2 (P2)**: independent. Touches only `people/[employeeId].tsx`
- **US3 (P3)**: independent. Touches two mobile file screens and one web component
- **US4 (P4)**: independent. Touches one web component

No story reads another's files, so all four can be staffed in parallel once Phase 2 lands.

### Within Each User Story

- Test stubs first (they are the reviewed contract), confirmed failing
- Types → derived state → controls → mounted forms
- Story's own test run last, before moving on

### Parallel Opportunities

- T006 and T007 in parallel (Go file vs Maestro file)
- T024 and T025 in parallel; T026, T027 and T028 in parallel (three different files)
- T030 and T031 in parallel
- T034–T037 in parallel (four different documents)
- US2, US3 and US4 can run alongside US1 entirely

---

## Parallel Example: User Story 3

```bash
# Test stubs together:
Task: "Extend compliance-report.spec.ts with web file scenarios"      # T024
Task: "Add .maestro/compliance/report-file.yaml"                       # T025

# Then all three controls together — different files, no shared state:
Task: "Report button on mobile files/index.tsx"                        # T026
Task: "Report button on mobile files/[fileId].tsx"                     # T027
Task: "Flag IconButton on web ManagementTab.tsx"                       # T028
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (T003–T005)
2. Phase 3 US1
3. **STOP and VALIDATE**: quickstart §2a–2e on Android and iOS; the largest body of unreportable content in the product now has a control
4. Ship if ready — US1 alone closes the gap a store reviewer finds first

### Incremental Delivery

1. Setup + Foundational → wrapper and predicate correct
2. US1 → thread report and block → validate → ship (MVP)
3. US2 → block from a profile → validate → ship
4. US3 → files on both clients → validate → ship
5. US4 → document comments → validate → ship
6. Polish → docs, counts, whole-suite gates

Each increment is releasable; none breaks a previous one.

### Parallel Team Strategy

After Phase 1: one person takes Phase 2 then US1 (the only sequenced pair); the others
take US2, US3 and US4 immediately — the four stories share no file.

---

## Notes

- No backend, proto, migration, `schema.sql` or permission change. The only Go file this
  feature touches is `backend/integration/compliance_report_test.go` (plus `helper_test.go`
  for `seedFile`). T039 enforces that
- No new report form, block confirmation or reason-label list on either client (FR-018) —
  every control mounts something that already exists in `components/compliance/` (mobile)
  or `workspace/components/` (web)
- The reporting client never sends the author or the content snapshot; the server resolves
  both (FR-020). No control added here may send either
- Mobile controls are verified on **Android as well as iOS** at each story's checkpoint,
  not only at the end
- Commit after each task or logical group

---

## Implementation record: where reality differed from the plan

The plan's central claim — "this is a client-side gap only" — did **not** hold. Five
defects were found by running the feature rather than reading it: three in the backend
(1–3 below), each making a stated functional requirement unsatisfiable from any client;
one in the shared API wrapper (4); and one those fixes exposed on a screen outside this
feature (5). A sixth, Android-only, is under "Other deviations". They are recorded here
because T039 and the Notes above assert that nothing but a test file moves in `backend/`.

None of them was found by reading the code. Every one came from running a control and
looking at what the server actually stored, or at what the screen actually showed.

### 1. `GetMessageById` never populated `channel_type`, so FR-002 was impossible

[ASSUMPTION: fixed in the server rather than worked around, because no client change can
recover a field the server does not send.]

Research [R-2](research.md) said the thread screen could read the parent conversation's
type out of `getMessageById`, and the wrapper was duly fixed to map the enum (T003). It
mapped an enum the server always left at zero: `internal/chat/logic.go` built its
`protoChannel` from `id`, `slug`, `display_name` and `is_private` only, and the query
`GetMessageByIdWithChannel` did not even select `c.channel_type`. `convertChannelType`
turned the resulting `UNSPECIFIED` into `'chat'`, so a report filed from a thread inside
a **direct conversation** was recorded as `chat_message`.

This was caught by running `report-thread-message.yaml` against a real simulator and
reading the row it wrote — the first channel in the test workspace happens to be a DM.
Before the fix: `chat_message`. After: `direct_message`.

Changed: `c.channel_type` added to the query, `sqlc generate` re-run,
`ChannelType: mapDBChannelTypeToProto(...)` set on the response. No migration and no
schema change — `schema.sql` is generated from migrations and none was added.

### 2. The same response dropped `message_kind`, so FR-003 was half-broken

The thread's parent card decides whether to offer Block from `messageKind !== 'system'`.
`GetMessageById` never set `MessageKind` (or `SystemEventType`) either, so every parent
card looked like something a person had said, and a system row opened as a thread root
would have offered "Block this person" for the employee named in it — the exact defect
research [R-4](research.md) set out to fix. Replies were unaffected: `listReplies`
populates the field. Both fields are now set from the embedded message row.

### 3. Reporting a deleted file succeeded, so US3 acceptance 5 was false

Research [R-9](research.md) recorded the deleted-file refusal as "already-correct
behaviour that this feature needs to test, not build". It was not. A file delete is a
**soft** delete, the metadata row survives it, and `fileResolver`'s lookup therefore
succeeded and filed a report against something nobody could open. T023 failed on first
run and is the evidence.

[ASSUMPTION: `fileResolver` now returns `ErrTargetNotFound` when `result.IsDeleted`,
rather than the scenario being softened to match the code. The spec's US3 acceptance 5
and FR-019 both state the person must be told the file is gone, and a report a reviewer
cannot act on is worth less than a refusal the reporter can read. A message reported
*before* its author deletes it still keeps its snapshot — that is the opposite case and
is unchanged.]

### 4. Every refusal reached the person with a transport code glued to the front

FR-019 and [contracts/surface-controls.md](contracts/surface-controls.md) say the person
reads "you have already reported this item; it is waiting for review". What the sheet
actually rendered on the device was `[already_exists] you have already reported this
item; it is waiting for review` — `ConnectError.message` carries a `[code] ` prefix
meant for logs, and `rpcWrapper.ts` passed it straight through. `AlreadyExists` also had
no case at all and fell through to the `NetworkError` default, so a refusal a person is
meant to read was typed as a transport failure.

[ASSUMPTION: fixed once in `frontend/packages/apis/src/rpcWrapper.ts` — `rawMessage`
instead of `message`, plus an explicit `AlreadyExists` branch — rather than stripping the
prefix in the two compliance forms. Every caller in both clients routes through that
wrapper and every one of them had the same leak; a guard in the shared function is a
smaller change than a guard in each form, and nothing asserted on the prefix.]

### 5. Making 4 safe required one change outside this feature

Giving `AlreadyExists` its own branch in `rpcWrapper.ts` changed what the **signup**
screen receives when a workspace address is taken: it used to arrive as a `NetworkError`
and `SignupError.tsx` told the person to check their internet connection, which was
already wrong. After the wrapper change it would have arrived as a plain `APIError` and
read "An unexpected error occurred" — different, still wrong.

[ASSUMPTION: `registerOrganization` in `apis/src/organization.ts` now converts a 409 into
`OrganizationError('SUBDOMAIN_TAKEN', …, 409)`, which is the behaviour its own docstring
has always documented and never implemented, and which `SignupError.tsx` already has the
right copy for ("This subdomain or email is already registered"). The alternative —
leaving signup on a worse message than before — would have made this feature's fix a
regression somewhere else.] `legal-surface.spec.ts` passes 7/8 before and after; its one
failure is pre-existing and reproduces with every code change in this branch stashed.

### Consequences for T039 and the Notes

`git diff --stat main -- backend/` shows more than `compliance_report_test.go`. The
files this feature changed under `backend/` are:

| File | Why |
|---|---|
| `database/scripts/chat.query.sql` | select `c.channel_type` (defect 1) |
| `database/chat.query.sql.go` | `sqlc generate` output, not hand-edited |
| `internal/chat/logic.go` | set `ChannelType`, `MessageKind`, `SystemEventType` (defects 1, 2) |
| `internal/compliance/resolvers.go` | refuse a soft-deleted file (defect 3) |
| `integration/chat_messaging_test.go` | the scenario that would have caught defects 1 and 2 |
| `integration/compliance_report_test.go` | the feature's own scenarios |
| `integration/helper_test.go` | `seedFile`, `getMessageById`, `errorReason` |

Still untouched, which is what FR-022 was really protecting: **no migration, no
`.proto`, no `schema.sql`, no permission seed.** The RPC surface is unchanged; two
fields that were always declared are now actually sent.

`GetMessageById` had **no** integration coverage before this feature, which is why the
unset fields survived. It has some now.

### Other deviations

- **T038's reason-label count returns three files, not two.** The third is
  `workspace/settings/reports/page.tsx`, the owner's review queue, which reads
  `REPORT_REASON_LABELS` to render a filed report's reason as a label. It is a read-only
  lookup, not a report form, and it is unchanged by this feature. FR-018/SC-003 constrain
  the number of *forms*, and there are still exactly one per client. The block count is
  exactly the two files quickstart §5 expects.
- **T013's path.** The re-export lives at `(shared)/resource/chat/thread/[messageId].tsx`,
  not `(app)/(shared)/...` as plan.md's tree says. It re-exports, so no second edit.
- **T016's note that `(more)/blocked.tsx` shares the query key** is not accurate at HEAD:
  that screen uses local state and its own `load()`. The profile shares the key with the
  **channel screen**, which is what makes FR-008's in-place flip work. Left alone rather
  than converted, which would be an unrelated refactor.
- **Two testIDs were added to screens this feature touches** so the flows could drive
  them: `message-action-thread` on the channel action sheet (its only row without one),
  and `thread-reply-input` / `thread-send-button` on the thread composer, whose
  `accessibilityLabel` is not exposed to Maestro.
- **`report-message.yaml` (pre-existing) was failing at HEAD** and is repaired here: it
  waited for `message-bubble-.*` before posting its own probe message, which cannot
  appear in an empty conversation, and the first channel in the test workspace is an
  empty DM. It now waits for the composer. `report-thread-message.yaml` copies the fixed
  opening.
- **The suite runner lists its flows by name, so a new `.yaml` runs in nothing until it
  is registered.** `frontend/apps/mobile/scripts/run-maestro-suite.sh` enumerates flows
  explicitly rather than globbing `compliance/*.yaml`, so `make test-mobile` was still
  green-by-omission on the three new files. All three are now listed, before
  `delete-account.yaml`, which ends the account they would otherwise still be using. Not
  mentioned by any task; found by reading the runner.
- **`report-file.yaml` asserts two acceptable outcomes.** There is no "unreport", so
  unlike `block-from-profile.yaml` the flow cannot restore the state it found, and a
  second run against the shared simulator account meets the already-filed refusal. The
  flow asserts the sheet reached a terminal state and, on the refusal branch, that the
  wording is readable prose and the sheet stayed open — which is FR-019 and SC-006.

### Gates that fail for reasons that predate this change

Each was confirmed by stashing every code change in this branch and watching the same
failure reproduce, so none is a consequence of this feature:

| Gate | Failure | Verified pre-existing by |
|---|---|---|
| `make test-frontend` | `legal-surface.spec.ts` "they cannot proceed without acknowledging the terms" (a client-side `toBeDisabled` on the signup form) and `user-guide-screenshots.spec.ts` "sign-in screens" (its API helper is refused with "those are not the terms currently in force") | stashing `frontend/` and `backend/` and re-running: 1 failed, 7 passed, identical |
| `make check-tracked-files` | `backend/tenancylint` is a tracked binary — already drift **D72** | `git log` shows it committed in the tenancylint refactor, long before this branch |
| `pnpm lint` | 185 problems repo-wide, four of them in files this feature edits (`apis/src/chat.ts`, `apis/src/organization.ts`) — all unused imports | stashing just those two files reproduces the same four errors |
| `make test-mobile` | several flows fail inside the shared `auth/signin.yaml` subflow, before reaching any screen. The failure screenshot shows the sign-in form with the email filled and the subdomain empty under "Subdomain is required": the `eraseText` + `inputText` pair on `subdomain-input` loses its text under IME timing on this simulator. `signin-known-device.yaml` fails this way in a run with every change stashed, and `more.yaml` passes or fails between runs with no code change at all | the same flows pass when run individually |

The mobile suite is therefore flaky at sign-in on this machine independently of this
feature. The three new flows were each run individually and repeatedly, on both
platforms, and passed every time sign-in itself succeeded.

This feature adds no new lint error and no new failing test.

### Coverage this change set does not have

- **quickstart §2d (a system row offers Report and not Block) has no automated check.**
  The data half is covered — `chat_messaging_test.go` asserts `GetMessageById` now
  returns `message_kind`, which it did not before, and an empty kind is what made every
  system row look like a person speaking. The UI half is a one-clause predicate written
  identically on both screens. [ASSUMPTION: no Maestro assertion was added for it. The
  only deterministic way to put a system row in front of the thread flow is to run the
  whole chat-to-task capture arrangement first — project picker included — inside a flow
  that otherwise needs none of it, which couples this feature's flow to feature 038's
  fixtures for one assertion. `report-thread-message.yaml` asserts the neighbouring half
  of FR-003 instead: a person is not offered Block on their own message.]
- **The mobile surfaces were driven on both platforms.** The three new flows pass on an
  iPhone 17 Pro Max simulator (iOS 26.2) and on a Medium Phone API 36.1 Android emulator.
  Android found two things iOS did not, both now fixed:
  - `ReportSheet` rendered its refusal **below the fold**. The sheet is `maxHeight: 85%`
    with a scrolling body, and the error sat under the note field; on a 1080×2400 screen a
    person whose report was refused saw the sheet simply not change, which is FR-019 and
    SC-006 failing silently. The error moved above the reason list and the body scrolls
    back to it when one appears.
  - The file row's two buttons were laid out with `justifyContent: 'space-between'` and a
    `minWidth: 116` Download button plus a `flex: 1` hint. Adding Report to that row would
    have squeezed on a narrow screen, so the row became a column of a two-button row and
    the hint beneath — which is the layout the file **detail** screen already used.
