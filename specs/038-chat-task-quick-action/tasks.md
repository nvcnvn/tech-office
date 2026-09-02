# Tasks: Create a Task from a Chat Message

**Input**: Design documents from `/specs/038-chat-task-quick-action/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: INCLUDED. Constitution principle II (Scenario-First Integration & E2E Testing) is
non-negotiable, and [contracts/test-scenarios.md](./contracts/test-scenarios.md) is the
approved behavioural contract. Every `t.Run` name below is taken from it verbatim.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested
and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3, mapping to the user stories in spec.md
- Every task names exact file paths

## Path Conventions

Multi-surface repository, used unchanged:

- Backend Go: `backend/internal/`, `backend/rpc/v1/`, `backend/database/`, `backend/integration/`
- Web: `frontend/apps/web/src/`, `frontend/apps/web/e2e/`
- Mobile: `frontend/apps/mobile/src/`, `frontend/apps/mobile/.maestro/`
- Shared API wrappers: `frontend/packages/apis/src/`

> **Path correction**: plan.md lists sqlc queries under `backend/database/queries/`. The real
> location in this repository is `backend/database/scripts/*.query.sql`. Tasks below use the
> real path.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Clear the planning gate and establish a known-green baseline before any change.

- [X] T001 Confirm the Principle II gate: tick the approval checkbox at the end of `specs/038-chat-task-quick-action/contracts/test-scenarios.md`, or stop and get it reviewed — no implementation task below may start until it is approved
- [X] T002 Bring local infrastructure up and apply existing migrations: `make infra-up`, then `backend/scripts/migrate.sh` with `DATABASE_URL` set, per `specs/038-chat-task-quick-action/quickstart.md`
- [X] T003 [P] Establish the regression baseline by running `make test-backend` and recording that it is green before any change in this feature lands

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, generated code, the cross-stack constant, the two pre-existing-behaviour
changes (D5, D6) and the chat logic-layer method. Every user story depends on all of it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. D5 in particular
is load-bearing — `CreateTask` currently parses `level_id` with `dbuuid.MustParse`, which
panics on an empty string, so nothing in this feature works until T016 lands.

### Schema

- [X] T004 Create `backend/database/migrations/20260901000001_task_from_chat_message.up.sql` adding `source_channel_id uuid NULL` and `source_message_id uuid NULL` to `collaboration.task`, the `CHECK ((source_channel_id IS NULL) = (source_message_id IS NULL))` constraint, composite foreign keys `(organization_id, source_channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE SET NULL` and `(organization_id, source_message_id) REFERENCES chat.message(organization_id, id) ON DELETE SET NULL`, and the partial index `idx_task_source_message ON collaboration.task (organization_id, source_message_id) WHERE source_message_id IS NOT NULL`
- [X] T005 In `backend/database/migrations/20260901000001_task_from_chat_message.up.sql`, create `collaboration.channel_task_destination` (`organization_id`, `channel_id`, `project_id`, `set_by_employee_id`, `updated_at DEFAULT now()`) with `PRIMARY KEY (organization_id, channel_id)` and the four foreign keys specified in `specs/038-chat-task-quick-action/data-model.md` §2 — no `id` column
- [X] T006 In `backend/database/migrations/20260901000001_task_from_chat_message.up.sql`, drop and recreate the `message_system_event_type_valid` CHECK on `chat.message` so it additionally admits `task_created_from_message`, leaving `message_system_event_consistency` untouched
- [X] T007 Apply the migration and regenerate the snapshot with `backend/scripts/regen-schema.sh`, producing an updated `backend/database/scripts/schema.sql` — never hand-edit that file
- [X] T008 Run `make lint-tenancy` from the repository root and fix any violation it reports on the new foreign keys or the new composite primary key

### Cross-stack constant (Principle VIII)

- [X] T009 [P] Add `SystemEventTypeTaskCreatedFromMessage = "task_created_from_message"` to `backend/internal/chat/constants.go` and admit it in the `IsValidSystemEventType` switch alongside the four voice values
- [X] T010 [P] Add `task_created_from_message` to the system-event union in `frontend/packages/apis/src/chat.ts` as a named constant, never an inline literal
- [X] T011 Extend `backend/integration/collaboration_constants_test.go` with `t.Run("task_created_from_message matches across DB, Go and TypeScript")` asserting the value is identical in the database CHECK, the Go constant and the TypeScript union

### Proto and generated code

- [X] T012 In `backend/rpc/v1/collaboration.proto`, change `string level_id = 3` to `optional string level_id = 3` on `CreateTaskRequest` and add `optional string source_channel_id = 28` and `optional string source_message_id = 29` to `Task`
- [X] T013 In `backend/rpc/v1/collaboration.proto`, add the four RPCs `CreateTaskFromMessage`, `ListTasksBySourceMessages`, `GetTaskOrigin`, `GetChannelTaskDestination` and `SetChannelTaskDestination` with their request/response messages, the `MessageTaskLink` message and the `ChannelDestinationUnsetReason` enum, each RPC declaring `required_permissions` exactly as specified in `specs/038-chat-task-quick-action/contracts/collaboration-proto.md`
- [X] T014 Run `buf generate` in `backend/` to regenerate `backend/rpc/v1/collaboration.pb.go`, the Connect service in `backend/rpc/v1/rpcv1connect/`, and the TypeScript output consumed by `frontend/packages/apis`
- [X] T015 Fix every caller broken by `level_id` becoming `*string` across `backend/internal/`, `backend/integration/` and `frontend/` — the compile break is the intended signal, not something to work around

### D5 and D6 — changes to existing behaviour

- [X] T016 In `backend/internal/collaboration/task_logic.go`, make `CreateTask` default the task level when `level_id` is absent by selecting the project's shallowest level, and move that resolution ahead of the `dbuuid.MustParse` call so an absent level can never panic
- [X] T017 In `backend/internal/collaboration/task_logic.go`, remove the eager chat-channel and description-document creation from `CreateTask` so no task provisions resources at creation time (D6)
- [X] T018 In `backend/internal/collaboration/task_logic.go`, remove the `TaskKindRitualInstance` gate from `EnsureTaskResources` (around line 426) so it provisions the chat channel and description document for any task on first open, exactly once
- [X] T019 [P] Extend `backend/integration/collaboration_task_test.go` with `t.Run("CreateTask with an explicit level_id behaves as before")` and `t.Run("CreateTask without a level_id selects the shallowest level")`
- [X] T020 [P] Extend `backend/integration/workflow_task_lifecycle_test.go` with `t.Run("a standard task is created without a chat channel or document")`, `t.Run("opening it provisions both, once")` and `t.Run("opening it twice does not create duplicates")`
- [X] T021 [P] Extend `backend/integration/collaboration_ritual_instance_test.go` with `t.Run("ritual instances still provision resources on first open")` to prove D6 caused no regression

### Chat logic-layer surface

- [X] T022 Widen the `ChatLogic` interface in `backend/internal/collaboration/logic.go` with `GetMessage` (already implemented on `chatLogicImpl`, so no chat-side change) and the new `AnnounceTaskCreatedFromMessage`, keeping the interface satisfied structurally with no change to `backend/cmd/server.go` wiring
- [X] T023 Implement `AnnounceTaskCreatedFromMessage` in `backend/internal/chat/logic.go`, modelled on `createVoiceSystemMessage`: insert one `chat.message` row with `message_kind = system`, `system_event_type = SystemEventTypeTaskCreatedFromMessage`, `parent_message_id = sourceMessageID`, `author_employee_id = actorID`, metadata `{taskId, identifier, title}` and empty mentions, running on the caller's transaction and returning the new message id — it MUST NOT call `broadcastNewMessage` or `notifyMentionedUsersV2`, and MUST NOT reuse `SendMessage`

### Behavioural contract scaffold

- [X] T024 Create `backend/integration/chat_task_capture_test.go` with `TestChatTaskCapture` using the `newTestWorld(t)` pattern from `backend/integration/helper_test.go`, containing every `t.Run` name from `specs/038-chat-task-quick-action/contracts/test-scenarios.md` as a `t.Skip("TODO: implement after scenario review")` stub with a `// FR-XXX` traceability comment

**Checkpoint**: Schema, generated code, constants, D5/D6 and the chat announce method are in
place; `make test-backend` is green again and user story work can begin.

---

## Phase 3: User Story 1 - Turn a message into a task without leaving the conversation (Priority: P1) 🎯 MVP

**Goal**: A member converts a message into a standard task from the message's own action
surface, without leaving the conversation, and a threaded announcement records it.

**Independent Test**: Open any channel, use "Create task" on a message, pick a project
explicitly, confirm, and verify a standard task exists in that project with the expected
title, creator, assignee and due date — with no chip, no origin block and no remembered
destination built.

### Tests for User Story 1 ⚠️

> Write these first; they must fail before the implementation tasks below.

- [X] T025 [US1] Implement the "when a member converts a message in a channel" scenario group in `backend/integration/chat_task_capture_test.go`: standard task created (FR-005), no ritual definition/scheduled date/deadline (FR-005, SC-007), default initial workflow state (FR-006), project-scoped `KEY-n` identifier (FR-006), level defaulted when none is named (FR-007/D5), converting member recorded as reporter (FR-005), assignee and due date applied (FR-007), task and announcement message id returned (FR-004)
- [X] T026 [P] [US1] Implement the "when the conversion request is malformed" group in `backend/integration/chat_task_capture_test.go`: empty title refused, whitespace-only title refused, missing project refused, nothing created in each case (FR-011)
- [X] T027 [P] [US1] Implement the "when the caller may not create the task" group in `backend/integration/chat_task_capture_test.go`: project viewer refused (FR-012), non-member of a private destination project refused (FR-012), project in another organization refused (FR-013, SC-008), non-member of a private source channel refused (FR-002)
- [X] T028 [P] [US1] Implement the "when the source message cannot be converted" group in `backend/integration/chat_task_capture_test.go`: system message refused and soft-deleted message refused (FR-002)
- [X] T029 [P] [US1] Implement the "Atomicity and failure" group in `backend/integration/chat_task_capture_test.go`: when the announcement cannot be written the task is not created either (FR-031), and when task creation fails no origin row, destination row or announcement survives (FR-030, FR-031)
- [X] T030 [P] [US1] Write a table-driven unit test for the title-derivation helper in `backend/internal/collaboration/task_from_message_logic_test.go` covering formatting stripped, whitespace collapsed, word-boundary truncation at the title limit, and empty/attachment-only input yielding an empty title (FR-009 and the long/formatted-message edge cases)

### Implementation for User Story 1

- [X] T031 [US1] Add the conversion queries to `backend/database/scripts/collaboration.query.sql`: write `source_channel_id` and `source_message_id` on the created task, and read a task back with its origin columns, using `sqlc.narg`/nullable parameters for the optional values (Principle IX)
- [X] T032 [US1] Run `sqlc generate` in `backend/` to produce the typed Go for the new queries
- [X] T033 [US1] Create `backend/internal/collaboration/task_from_message_logic.go` implementing `CreateTaskFromMessage`: validate the title is non-empty after trimming, verify the caller can read the source channel and that the message is neither `system` kind nor soft-deleted, verify the destination project is in the caller's organization, then delegate to the existing `CreateTask` logic so workflow rules, notifications, search indexing and analytics apply unchanged, write the origin columns, and post the announcement through `ChatLogic.AnnounceTaskCreatedFromMessage`
- [X] T034 [US1] Implement the title-derivation helper in `backend/internal/collaboration/task_from_message_logic.go`: strip formatting to plain text, collapse whitespace, truncate at a word boundary at the title limit, and return empty for an attachment-only or empty message body (FR-009)
- [X] T035 [US1] Add the feature's error constants to `backend/internal/collaboration/constants.go`, including the `FailedPrecondition` + `PreconditionFailure` detail naming the project for an unusable destination (FR-018, Principle X) and the `InvalidArgument` + `BadRequest` detail naming the `title` field (FR-011)
- [X] T036 [US1] Add the `CreateTaskFromMessage` Connect handler to `backend/internal/collaboration/connect.go`, opening a single `txn.WithTxn` so the task row, origin columns and announcement commit together or not at all (FR-031, D9), keeping the connect layer thin (Principle III)
- [X] T037 [P] [US1] Add the `createTaskFromMessage` wrapper with hand-written input/output interfaces and native types to `frontend/packages/apis/src/collaboration.ts`, and export it from `frontend/packages/apis/src/index.ts` (Principle VII)
- [X] T038 [US1] Create `frontend/apps/web/src/app/workspace/chat/components/CreateTaskFromMessageDialog.tsx` with exactly four inputs (title, project, assignee, due date), the title pre-filled and focused with its text selected, inline field-level errors, a "More options" escape that opens the full task form carrying entered values, values retained on failure, `data-testid` on every interactive element and theme colours only (FR-004, FR-007, FR-008, FR-009, FR-011, FR-030)
- [X] T039 [US1] Add the "Create task" entry to the hover action menu in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`, offered only for `text` and `voice` messages in a non-archived channel the user belongs to, hidden for `system` messages, unsent messages and users with no task-create permission anywhere (FR-001, FR-002, FR-003)
- [X] T040 [US1] Create `frontend/apps/mobile/src/components/chat/create-task-sheet.tsx` as a purpose-built bottom sheet — not a port of the web dialog — with the same four fields, defaults and rules, `testID` on every interactive element, verified on both Android and iOS (Principle XIII)
- [X] T041 [US1] Add the "Create task" entry to the existing long-press action sheet in `frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx` with the same gating as T039
- [X] T042 [US1] Implement single-mention assignee pre-selection in both clients — pre-select when the source message mentions exactly one person who is an employee in the organization, leave empty for zero or more than one, and allow clearing (FR-010)
- [X] T043 [P] [US1] Create `frontend/apps/web/e2e/chat-task-capture.spec.ts` with the "creating a task from a message" group: hover menu offers Create task (FR-001), dialog opens with the message text focused and selected (FR-009), single mention preselected (FR-010), project picker expanded with no remembered project (FR-014), confirming creates the task and shows a confirmation naming it (FR-004), dialog closes with scroll position preserved (FR-004), More options carries entered values (FR-008)
- [X] T044 [P] [US1] Add the "refusals" group to `frontend/apps/web/e2e/chat-task-capture.spec.ts`: empty title shows an inline field error and creates nothing (FR-011), and a failed conversion keeps the dialog open with values intact (FR-030)
- [X] T045 [P] [US1] Create `frontend/apps/mobile/.maestro/chat-task-capture.yaml` covering long-press opens the action sheet with Create task (FR-001), the bottom sheet opens with the title prefilled (FR-009), and picking a project and confirming creates the task (FR-004)

**Checkpoint**: User Story 1 is fully functional and testable on its own — a message becomes
a task and a threaded announcement appears, with the project picked explicitly every time.

### Notes from implementation (Phases 1–3)

Recorded here so the next person does not have to rediscover them:

- **T012/T013 used `rpc.v1.access_control`, not `rpc.v1.auth`.** The contract document names
  the option `rpc.v1.auth`; the option this repository actually defines and the interceptor
  actually reads is `rpc.v1.access_control`. The real one was used.
- **T021's target file was `ritual_tasks_improvement_test.go`, not
  `collaboration_ritual_instance_test.go`.** The ritual lazy-resource behaviour this feature
  had to avoid regressing lives in the former, alongside the standard-task assertions D6
  inverted, so both changes landed in one file.
- **D6 needed one change the plan did not anticipate.** With provisioning moved to first
  open, whoever opened a task first became the admin of its discussion channel, because
  `EnsureTaskResources` created it as the opening employee. That made channel ownership race
  on who happened to look first, and broke every test where one person creates a task and
  another opens it. `EnsureTaskResources` now creates both resources as the task's
  **reporter**, which is what the eager path in `CreateTask` always did.
- **`sendTaskComment` / `updateTaskDescriptionDocument` open the task first.** Both test
  helpers previously asserted the resources already existed. Fixing them at the shared
  helper rather than at each call site is what kept D6's blast radius to three files.
- **The remembered channel destination is deliberately absent from `CreateTaskFromMessage`.**
  It belongs to T076 in User Story 3; US1's independent test explicitly requires that no
  remembered destination is built.
- **T043–T045 are written but not executed.** Playwright needs a running web dev server and
  Maestro needs a device or simulator; neither was run in this pass.

---

## Phase 4: User Story 2 - See what a message became, and get back to the conversation (Priority: P2)

**Goal**: The message carries an access-filtered chip naming the resulting task and its live
state, and the task carries an origin block linking back to the exact message.

**Independent Test**: Create a task from a message, reload both the channel and the task
detail view, and verify the chip appears on the message, the origin block appears on the
task, and each navigates to the other.

### Tests for User Story 2 ⚠️

- [X] T046 [US2] Implement the "when a task has been created from a message" group in `backend/integration/chat_task_capture_test.go`: the task stores source channel and source message together (FR-019), `GetTaskOrigin` returns channel name, author and excerpt (FR-020), `ListTasksBySourceMessages` returns the link with live task state (FR-021), one call resolves links for a whole page of message ids (N+1 guard), and a message converted twice returns both links (FR-025)
- [X] T047 [P] [US2] Implement `t.Run("when the viewer cannot access the destination project → ListTasksBySourceMessages omits the link entirely")` in `backend/integration/chat_task_capture_test.go` (FR-021, SC-008)
- [X] T048 [P] [US2] Implement the "when the source message is soft-deleted afterwards" group in `backend/integration/chat_task_capture_test.go`: the task still exists with its origin intact and `GetTaskOrigin` reports the message unavailable (FR-023)
- [X] T049 [P] [US2] Implement `t.Run("when the task is deleted afterwards → ListTasksBySourceMessages returns no link for that message")` in `backend/integration/chat_task_capture_test.go` (FR-024)
- [X] T050 [P] [US2] Implement the "when the conversion is announced" group in `backend/integration/chat_task_capture_test.go`: posted as a reply to the source message (FR-028), carries task id, identifier and title (FR-028), attributed to the converting member (FR-028), produces no reply or mention notification for anyone (FR-028a), and the source message author is not notified (FR-029)
- [X] T051 [P] [US2] Implement `t.Run("when an assignee is named at creation → the assignee receives the ordinary task-assignment notification")` in `backend/integration/chat_task_capture_test.go` (FR-027)

### Implementation for User Story 2

- [X] T052 [US2] Add the reverse-lookup queries to `backend/database/scripts/collaboration.query.sql`: a batched select of tasks by `(organization_id, source_message_id IN …)` joined to `collaboration.project` and the workflow state for identifier, title, state name and category, filtered by the caller's project access — same schema only, no cross-schema join
- [X] T053 [US2] Run `sqlc generate` in `backend/` for the new queries
- [X] T054 [US2] Implement `ListTasksBySourceMessages` in `backend/internal/collaboration/task_from_message_logic.go`, accepting up to 200 message ids in one call and omitting — never flagging — links to tasks in projects the caller cannot access (FR-021)
- [X] T055 [US2] Implement `GetTaskOrigin` in `backend/internal/collaboration/task_from_message_logic.go`, resolving channel name, author display name and excerpt through `ChatLogic.GetMessage` and setting `source_message_available = false` once the message is soft-deleted (FR-020, FR-023)
- [X] T056 [US2] Add the `ListTasksBySourceMessages` and `GetTaskOrigin` Connect handlers to `backend/internal/collaboration/connect.go`, and populate `Task.source_channel_id` / `Task.source_message_id` in the existing task-to-proto mapping
- [X] T057 [P] [US2] Add the `listTasksBySourceMessages` and `getTaskOrigin` wrappers to `frontend/packages/apis/src/collaboration.ts` and export them from `frontend/packages/apis/src/index.ts`
- [X] T058 [US2] Render the task chip in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`, resolved by a single batched call per rendered page from `frontend/apps/web/src/app/workspace/chat/components/MessageList.tsx` and `VirtualizedMessageList.tsx` — never one call per message — capping the rendered chips with an overflow indicator (FR-021, D3)
- [X] T059 [US2] Add the origin block (channel name, message author, excerpt, and a link opening the conversation at the message) to `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`, using the canonical `r/chat/{channelId}?anchorType=message&anchorId={messageId}` link and stating that the source message is unavailable when it has been deleted (FR-020, FR-022, FR-023, D8)
- [X] T060 [US2] Add the `task_created_from_message` case to the existing `messageKind === 'system'` rendering branch in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`, rendering the metadata's identifier and title as a link to the task
- [X] T061 [US2] Render the chip in `frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx` with the same single batched resolution per page and the same cap, plus the `task_created_from_message` system-message case in `frontend/apps/mobile/src/components/chat/chat-message-body.tsx`
- [X] T062 [US2] Add the origin block to `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx` and `frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx`, navigating via the canonical link (FR-020, FR-022)
- [X] T063 [US2] Show existing tasks and require a second explicit confirmation when the action is opened on an already-converted message, in both `frontend/apps/web/src/app/workspace/chat/components/CreateTaskFromMessageDialog.tsx` and `frontend/apps/mobile/src/components/chat/create-task-sheet.tsx` (FR-025)
- [X] T064 [P] [US2] Add the "seeing the result" group to `frontend/apps/web/e2e/chat-task-capture.spec.ts`: chip naming the task and its state appears (FR-021), chip opens the task detail (FR-022), announcement reply appears in the thread (FR-028), task detail shows channel/author/excerpt (FR-020), origin link opens the channel highlighting the source message (FR-022)
- [X] T065 [P] [US2] Add `t.Run`-equivalent coverage to `frontend/apps/web/e2e/chat-task-capture.spec.ts` for converting an already-converted message warning before proceeding (FR-025)
- [X] T066 [P] [US2] Extend `frontend/apps/mobile/.maestro/chat-task-capture.yaml` with the chip appearing on the message and tapping it opening the task detail with its origin block (FR-021, FR-020, FR-022)

**Checkpoint**: User Stories 1 and 2 both work independently — conversions are visible from
both directions and access-filtered correctly.

---

## Phase 5: User Story 3 - The channel remembers where its tasks go (Priority: P3)

**Goal**: A channel's first conversion sets its remembered destination; later conversions
pre-fill it collapsed, individual conversions can override without changing it, and channel
administrators can change or clear it.

**Independent Test**: Convert in a channel with no remembered destination and verify the
picker is required; convert a second time and verify the project is pre-filled and collapsed;
change the default and verify the third conversion follows the new value.

### Tests for User Story 3 ⚠️

- [X] T067 [US3] Implement the "when a channel has never had a task created from it" and "when the first task is created from a channel" groups in `backend/integration/chat_task_capture_test.go`: unset with reason `NEVER_SET` (FR-014), no project inferred from the caller's history or the org default (FR-014), and the first conversion's project becomes the remembered destination (FR-015)
- [X] T068 [P] [US3] Implement the "when a later conversion overrides the project" group in `backend/integration/chat_task_capture_test.go`: the task is created in the overridden project and the remembered destination is unchanged (FR-016)
- [X] T069 [P] [US3] Implement the "when a channel administrator manages the destination" group in `backend/integration/chat_task_capture_test.go`: they can set it, they can clear it, and a non-admin member is refused (FR-017)
- [X] T070 [P] [US3] Implement the "when the remembered destination is no longer usable" group in `backend/integration/chat_task_capture_test.go`: archived project reports `PROJECT_ARCHIVED`, deleted project reports `PROJECT_DELETED`, a project the caller cannot write to reports `NO_ACCESS`, and converting into it fails with a precondition detail naming the project (FR-018)
- [X] T071 [P] [US3] Implement the "when two channels are used" and "when the channel is a direct message" scenarios in `backend/integration/chat_task_capture_test.go`: each channel remembers its own destination independently, and a DM remembers its own like any other channel (FR-015, edge case)

### Implementation for User Story 3

- [X] T072 [US3] Add the destination queries to `backend/database/scripts/collaboration.query.sql`: read a channel's destination joined to `collaboration.project` for name, key and `is_archived`; insert with `ON CONFLICT DO NOTHING`; upsert on explicit set; and delete on clear
- [X] T073 [US3] Run `sqlc generate` in `backend/` for the destination queries
- [X] T074 [US3] Create `backend/internal/collaboration/channel_destination_logic.go` implementing `GetChannelTaskDestination` and `SetChannelTaskDestination`, resolving `is_set = false` with the right `ChannelDestinationUnsetReason` at read time when the project is archived, deleted or not writable by the caller — never deleting the row (FR-018, data-model.md §2)
- [X] T075 [US3] Add the channel-admin resource check to `SetChannelTaskDestination` in `backend/internal/collaboration/channel_destination_logic.go`, sitting in the logic layer above the interceptor's `collab.createTask` permission check, in the same shape as ritual-definition management (FR-017, Principle III)
- [X] T076 [US3] Record the channel's destination on conversion in `backend/internal/collaboration/task_from_message_logic.go` with `INSERT … ON CONFLICT DO NOTHING`, so the first conversion sets it and any later override leaves it untouched (FR-015, FR-016)
- [X] T077 [US3] Add the `GetChannelTaskDestination` and `SetChannelTaskDestination` Connect handlers to `backend/internal/collaboration/connect.go`
- [X] T078 [P] [US3] Add the `getChannelTaskDestination` and `setChannelTaskDestination` wrappers to `frontend/packages/apis/src/collaboration.ts`, mapping `ChannelDestinationUnsetReason` to its client-side one-line explanation, and export them from `frontend/packages/apis/src/index.ts`
- [X] T079 [US3] Make the project field in `frontend/apps/web/src/app/workspace/chat/components/CreateTaskFromMessageDialog.tsx` expand when the destination is unset and collapse to a single changeable line when it is set, blocking confirmation until a project is chosen and showing the one-line reason from `unset_reason` when the remembered destination is unusable (FR-014, FR-018, SC-002)
- [X] T080 [US3] Add the channel task destination control (view, change, clear) to channel settings in `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx`, visible to channel administrators only — web-only per Principle XIII (FR-017)
- [X] T081 [US3] Apply the same collapsed/expanded destination behaviour to `frontend/apps/mobile/src/components/chat/create-task-sheet.tsx`, which reads the destination and can override it for one conversion but never sets it (Principle XIII)
- [X] T082 [P] [US3] Add the "the remembered destination" group to `frontend/apps/web/e2e/chat-task-capture.spec.ts`: the second conversion pre-fills the project collapsed (FR-015, SC-002), overriding does not change the remembered one (FR-016), and a channel admin changes it in channel settings (FR-017)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T083 [P] Update `docs/domain/rituals-tasks.md` with tasks created from chat messages and the eager→lazy resource change, deleting what it currently implies about where task channels come from (Principle XII)
- [X] T084 [P] Update `docs/domain/chat.md` with the `task_created_from_message` system event type and the non-notifying threaded announcement (Principle XII)
- [X] T085 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` and `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` where the new collaboration→chat call and the suppressed notification path change what they describe (Principle XII)
- [X] T086 Run `make lint-tenancy` and `make test-backend` in full — `TestChatTaskCapture` passing alone is not sufficient, since D6 changed when every task gets its resources
- [X] T087 [P] Run `make test-frontend` including `make test-frontend-one F=task-lifecycle` as the D6 regression net
- [ ] T088 [P] Run `make test-mobile-one F=chat-task-capture` on both an Android and an iOS device, per the mobile testing rule — **not run**: no booted simulator, no attached Android device and no Maestro binary in the implementation environment. The flow is written and extended through User Story 2; it has never been executed.
- [ ] T089 Walk through `specs/038-chat-task-quick-action/quickstart.md` §5 manually, confirming SC-002 (a second conversion in a remembered channel takes exactly two interactions) and that a user without project access sees no chip — **not run** as a manual walkthrough. Both properties do have automated coverage: SC-002 by the "second conversion pre-fills the project collapsed" web E2E, and the invisible chip by `t.Run("ListTasksBySourceMessages omits the link entirely")`.

### Notes from implementation (Phases 4–6)

- **T080's file was `MessageList.tsx`, not `ChannelSidebar.tsx`.** `ChannelSidebar` is the
  channel *list*; the channel header, which is where per-channel controls live, is in
  `MessageList.tsx`. The destination control and its dialog
  (`ChannelTaskDestinationDialog.tsx`) went there, gated on
  `channelData.currentUserMembership.isAdmin`.
- **T058's batched lookup lives only in `VirtualizedMessageList.tsx`.** The task names both
  it and `MessageList.tsx`, but `MessageList` renders no `MessageItem` — it delegates to
  `VirtualizedMessageList`, which is the single render site and therefore the single place
  the lookup belongs.
- **`ChatLogic` gained `GetChannel`.** The plan anticipated only `GetMessage` and
  `AnnounceTaskCreatedFromMessage`, but the origin block needs the channel's display name
  and `SetChannelTaskDestination` needs the caller's channel-admin flag. Both come from
  `GetChannel`, already implemented on `chatLogicImpl`, so the interface is still satisfied
  structurally and `internal/chat` gained nothing.
- **A pre-existing `task_count` bug surfaced and was fixed.** `CreateTask` called
  `IncrementProjectTaskCount` without setting `TaskCount`, so the delta defaulted to 0 and
  the counter never rose, while `DeleteTask` still decremented by 1. The first deletion in
  any project drove `task_count` to -1 and tripped `project_task_count_check`, which is
  what T049 hit. Fixed at both call sites (`task_logic.go`, `scheduler_logic.go`). It is
  not a feature-038 regression; nothing had deleted a task in a test before.
- **The web chip had to stop being a `clickable` MUI `Chip`.** As `component={NextLink}`
  MUI's `ButtonBase` rendered the anchor but Next's click handling never ran; wrapping the
  Chip in a `NextLink` and leaving it `clickable` was worse still, because MUI then renders
  a `<button>` inside the `<a>` and the button eats the click. The chip is now a plain Chip
  inside a `NextLink`. The E2E caught this; it looked like a link and did nothing.
- **`MessageItem` now carries `data-testid="message-row-<id>"`.** Without a per-message
  handle the E2E could only act on whichever message rendered first, which is wrong in a
  channel holding several converted messages. This mirrors mobile's existing
  `message-bubble-<id>`.
- **PROJECT_DELETED is implemented but unreachable.** `GetChannelTaskDestination` returns it
  when a destination row outlives its project, but the row's project foreign key is
  `ON DELETE CASCADE` (as data-model.md specifies) and the product exposes no project
  deletion at all. The scenario's assertion was written against what actually happens — the
  destination cascades away and the channel reads `NEVER_SET` — with the reason recorded in
  the test body.
- **The mobile announcement is a record, not a link.** Its metadata carries no project id
  and every mobile task route is project-scoped, so there is nowhere to navigate. The chip
  on the source message does carry one, and that is what navigates.
- **`make test-frontend-one` has a path bug.** `pnpm --filter web exec` already runs in
  `apps/web`, so `--config=apps/web/e2e/playwright.config.ts` resolves to
  `apps/web/apps/web/...`. The specs were run with `npx playwright test
  --config=e2e/playwright.config.ts` from `apps/web` instead. Not fixed here — it is
  outside this feature.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 is a hard gate on everything below
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–5)**: All depend on Phase 2; can then run in parallel or in priority order P1 → P2 → P3
- **Polish (Phase 6)**: Depends on all desired user stories

### Within Phase 2

- T004 → T005 → T006 are the same migration file, so strictly sequential
- T007 depends on T004–T006; T008 depends on T007
- T009/T010 are parallel; T011 depends on both plus T007
- T012 → T013 → T014 → T015 sequential (same proto file, then codegen, then fallout)
- T016 depends on T014; T017 → T018 touch the same file as T016, so sequential
- T019/T020/T021 are parallel and depend on T016–T018
- T022 → T023 sequential (interface before implementation)
- T024 depends on nothing in Phase 2 but is most useful once T014 has landed

### User Story Dependencies

- **US1 (P1)**: Depends only on Phase 2 — the MVP
- **US2 (P2)**: Depends on Phase 2; its scenarios need conversions to exist, so it is practically implemented after US1, but its RPCs and views are independently testable against fixture data
- **US3 (P3)**: Depends on Phase 2; T076 edits `task_from_message_logic.go`, which US1 creates, so US1 lands first

### Within Each User Story

- Tests are written first and must fail before implementation
- Queries → `sqlc generate` → logic → Connect handler → API wrapper → web → mobile → E2E

### Parallel Opportunities

- T009 and T010 (Go and TypeScript constants) run together
- T019, T020, T021 (three separate D5/D6 regression suites) run together
- All `[P]`-marked test tasks within a story run together — they are separate `t.Run` groups
- T037, T057, T078 (API wrappers) are independent of the web and mobile work in their phases
- T083, T084, T085 (three separate docs) run together
- With capacity, US2's web work (T058–T060) and mobile work (T061–T062) run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch the backend scenario groups for User Story 1 together:
Task: "Malformed conversion requests in backend/integration/chat_task_capture_test.go"
Task: "Authorization refusals in backend/integration/chat_task_capture_test.go"
Task: "Unconvertible source messages in backend/integration/chat_task_capture_test.go"
Task: "Atomicity and failure in backend/integration/chat_task_capture_test.go"
Task: "Title-derivation unit test in backend/internal/collaboration/task_from_message_logic_test.go"

# Launch the client-surface tests together once the RPC exists:
Task: "Creating-a-task group in frontend/apps/web/e2e/chat-task-capture.spec.ts"
Task: "Maestro flow in frontend/apps/mobile/.maestro/chat-task-capture.yaml"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 — in particular T001, the Principle II approval gate
2. Complete Phase 2 — this is the largest blocking phase, because D5 and D6 change existing behaviour for every task in the system
3. Complete Phase 3 — User Story 1
4. **STOP and VALIDATE**: convert a message with an explicit project every time; `make test-backend` must be green, not just `TestChatTaskCapture`
5. Ship — the round trip that stopped teams recording work is already gone

### Incremental Delivery

1. Setup + Foundational → schema, proto, constants, D5/D6 landed and the full backend suite green
2. Add User Story 1 → conversion works with an explicit picker → ship (MVP)
3. Add User Story 2 → chip and origin block make it trustworthy → ship
4. Add User Story 3 → the memory makes it reflex → ship

### Parallel Team Strategy

After Phase 2:

- Developer A: User Story 1 (backend logic, web dialog, mobile sheet)
- Developer B: User Story 2 (reverse lookup, chip, origin block) against fixture rows
- Developer C: User Story 3 (destination logic, channel settings)

US1 lands first because T076 (US3) and the US2 scenarios build on
`task_from_message_logic.go`.

---

## Notes

- Phase 2 is unusually heavy for this feature by design: D5 and D6 are net deletions in
  existing code that everything else depends on, and D5's `dbuuid.MustParse` panic on an
  empty `level_id` blocks every path in this feature until T016 lands.
- The chip must be resolved by one batched call per rendered page. A per-message
  implementation is visibly wrong against the `repeated message_ids` contract shape, and
  T046 asserts it.
- The announcement must never call `broadcastNewMessage` or reuse `SendMessage`. That
  omission is the whole of FR-028a.
- `backend/database/scripts/schema.sql` is generated. Regenerate it (T007); never edit it.
- `internal/chat` must not gain any import of `internal/collaboration` in any task above.
- Commit after each task or logical group; stop at any checkpoint to validate a story
  independently.
