# Implementation Plan: Create a Task from a Chat Message

**Branch**: `038-chat-task-quick-action` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/038-chat-task-quick-action/spec.md`

## Summary

A message in any chat channel gains a "Create task" action that produces an ordinary
standard task, records which message it came from, and links the two directions together.

The whole feature is owned by `internal/collaboration`. That is the load-bearing decision:
`collaboration` already depends on `chat` (it calls `ChatLogic.CreateChannel` for task
comment threads), and the reverse dependency would be a cycle. So every new table, every
new RPC and the only new business logic live in collaboration; `chat` gains exactly one
logic-layer method — an announce call modelled on the one voice already uses to leave a
call record in a channel timeline — and no knowledge of tasks whatsoever.

Three pieces of existing behaviour are changed rather than worked around:

1. `CreateTaskRequest.level_id` becomes optional and defaults server-side. The quick sheet
   has four fields and a task level is not one of them; today the field is required and
   parsed with `dbuuid.MustParse`, which panics on empty input.
2. `CreateTask` stops eagerly creating the task's chat channel and description document.
   `EnsureTaskResources` loses its "ritual instances only" gate and provisions them for any
   task on first open. This is what FR-026a asks for, it deletes a branch rather than adding
   one, and the web task detail already has a retry path for a task whose resources are not
   yet provisioned.
3. `chat.message.system_event_type` gains one value so a conversion can leave a threaded,
   non-notifying trace on the source message.

## Technical Context

**Language/Version**: Go 1.27 (backend); TypeScript 5 with React 19 / Next.js App Router
(web); TypeScript with Expo Router / React Native (mobile)

**Primary Dependencies**: Connect-RPC + protobuf (`rpc/v1`), sqlc + pgx (data access),
`flows` (scheduling — not used by this feature), MUI v7 (web), Expo Router + TanStack Query
(mobile), `packages/apis` typed wrappers (both clients)

**Storage**: PostgreSQL, single node, schema-per-domain. New objects in the `collaboration`
schema plus one CHECK-constraint widening in the `chat` schema.

**Testing**: Go integration tests in `backend/integration/` (testWorld pattern), Playwright
E2E in `frontend/apps/web/e2e/`, Maestro flows in `frontend/apps/mobile/.maestro/`

**Target Platform**: Linux server; modern browsers; iOS and Android via Expo

**Project Type**: Multi-tenant web service with a web client and a mobile client

**Performance Goals**: Conversion round trip p95 under 500 ms. Chip resolution costs exactly
one additional RPC per rendered page of messages, batched — never one call per message.

**Constraints**: No cross-schema SQL joins. `internal/chat` MUST NOT gain a dependency on
`internal/collaboration`. Every new unique key and foreign key leads with `organization_id`.
Conversion is atomic: task row, origin columns, destination memory and announcement commit
together or not at all (FR-031).

**Scale/Scope**: SMB tenants, small teams. Expected volume is a handful of conversions per
channel per day — cheap enough that the design optimises for correctness and for not
creating chat channels nobody reads, rather than for throughput.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| I. Data Governance & Multi-Tenancy | New tables carry `organization_id`; PK/unique keys lead with it; FKs reference composite keys; no unmarked cross-tenant query; forward-only timestamped migration; `schema.sql` regenerated not hand-edited | **PASS** — `channel_task_destination` PK is `(organization_id, channel_id)`; both new task FKs are composite; new index is `(organization_id, source_message_id)` partial. No `AdminPool` use. |
| II. Scenario-First Integration & E2E | Every User Story and user-observable FR traced to a `t.Run` scenario, stubs approved before tasks | **PASS pending approval** — behavioural contract in [contracts/test-scenarios.md](./contracts/test-scenarios.md); this is the gate to clear before `/speckit-tasks`. |
| III. Two-Layer Service Architecture & Proto-Level Auth | Connect layer thin, logic layer pool-agnostic, `required_permissions` declared per RPC | **PASS** — four new RPCs, each with a declared permission; resource-level checks (project role, channel admin) in the logic layer as rituals already do. |
| IV. Cross-Domain Integration | No cross-schema SQL; dependencies via logic interfaces; shared `tx` | **PASS** — collaboration→chat only, through an extended `ChatLogic` interface, sharing the caller's transaction. Chat gains nothing about tasks. |
| V. Observability, Simplicity & YAGNI | Simple, `log/slog`, no premature abstraction | **PASS** — net deletion in `CreateTask`; no new background job, no cache, no new service. |
| VI. Versioning & Breaking Changes | Breaking changes shipped atomically across the stack | **PASS** — `level_id` optionality and the lazy-resources change land in one change set covering backend, web and mobile. |
| VII. Frontend API Wrapper Pattern | No protobuf types in apps; wrappers in `packages/apis`; `data-testid` / `testID` on interactive elements; theme colours only | **PASS** — new wrappers in `packages/apis/src/collaboration.ts`. |
| VIII. Cross-Stack Constant Sync | Named constants, no literals, sync test | **PASS** — `task_created_from_message` defined in the DB CHECK, `internal/chat/constants.go` and a shared TS constant, covered by the existing `collaboration_constants_test.go` pattern. |
| IX. UUID v7 & Nullable Params | v7 keys; `sqlc.narg` / `dbuuid.NullUUID` for optionals | **PASS** — `source_message_id` and the optional assignee/due date use nullable parameters. |
| X. Structured Error Details | Only where a code is insufficient | **PASS** — one use: a conversion refused because the destination is no longer usable returns `FailedPrecondition` with a `PreconditionFailure` naming the project, so the sheet can reopen the picker instead of showing a dead end (FR-018). |
| XI. Distributed-First | No node-local state | **PASS** — all state is in PostgreSQL; conversion is a single transaction. |
| XII. Living Documentation | `docs/domain/` and `backend/docs/` updated in the same change set | **PLANNED** — `docs/domain/rituals-tasks.md` and `chat.md` both change; the eager→lazy resource change also corrects what `rituals-tasks.md` currently implies. Enforced by the mandatory `speckit.docs.snapshot` hook after implement. |
| XIII. Mobile Design & Testing | Employee day-to-day only; purpose-built mobile layout; `testID`; Maestro flow | **PASS** — capturing a task from a conversation is day-to-day employee work. Mobile uses the existing long-press action sheet and a bottom sheet, never a copy of the web dialog. Channel-destination *administration* (FR-017) is web-only, consistent with the admin/web split. |

No violations to justify. The Complexity Tracking table is therefore omitted.

## Architecture Decisions

Full rationale and rejected alternatives in [research.md](./research.md). In brief:

- **D1 — Collaboration owns the feature.** Chat must not learn about tasks.
- **D2 — Origin is two columns on `collaboration.task`**, not a join table: a task has at
  most one origin, and `fk_task_channel` is the existing precedent for a composite
  cross-schema foreign key from collaboration into chat.
- **D3 — The chip is resolved by a collaboration RPC batched over the visible page**, not
  read out of chat message metadata. Access filtering has to happen server-side (FR-021) and
  the chip shows live state.
- **D4 — The channel's remembered project lives in collaboration**, keyed by channel id.
  Putting it on `chat.channel` would put a collaboration concept in chat's schema.
- **D5 — `level_id` becomes optional**, defaulting to the project's shallowest level.
- **D6 — Task resources become uniformly lazy.** Removes eager creation from `CreateTask`
  and the ritual-only gate from `EnsureTaskResources`.
- **D7 — The announcement is a threaded `system` message**, authored by the converting user,
  written through a new `ChatLogic.AnnounceTaskCreatedFromMessage`, with no notification
  fan-out — the same mechanism voice uses for call records.
- **D8 — Both navigation directions reuse canonical resource links.** `r/task/{id}` one way,
  `r/chat/{channelId}?anchorType=message&anchorId={messageId}` the other. No new format.

## Project Structure

### Documentation (this feature)

```text
specs/038-chat-task-quick-action/
├── plan.md                       # This file
├── spec.md
├── research.md                   # Phase 0 — decisions and rejected alternatives
├── data-model.md                 # Phase 1 — schema delta
├── quickstart.md                 # Phase 1 — how to run and validate
├── contracts/
│   ├── collaboration-proto.md    # RPC and message delta
│   ├── chat-contract.md          # ChatLogic delta + system event constant
│   └── test-scenarios.md         # Behavioural contract (Principle II gate)
├── checklists/requirements.md
└── tasks.md                      # Created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── database/
│   ├── migrations/20260901000001_task_from_chat_message.up.sql   # new
│   ├── queries/collaboration.query.sql                           # new queries
│   └── scripts/schema.sql                                        # regenerated, never edited
├── rpc/v1/collaboration.proto                                    # 4 RPCs, Task fields, level_id optional
├── internal/
│   ├── collaboration/
│   │   ├── task_from_message_logic.go                            # new — conversion + origin + chip
│   │   ├── channel_destination_logic.go                          # new — remembered destination
│   │   ├── task_logic.go                                         # CreateTask: drop eager resources, default level
│   │   ├── connect.go                                            # 4 new handlers
│   │   ├── constants.go                                          # new error/reason constants
│   │   └── logic.go                                              # ChatLogic interface widened
│   └── chat/
│       ├── logic.go                                              # AnnounceTaskCreatedFromMessage
│       └── constants.go                                          # SystemEventTypeTaskCreatedFromMessage
└── integration/
    ├── chat_task_capture_test.go                                 # new — behavioural contract
    └── collaboration_constants_test.go                           # extended — constant sync

frontend/
├── packages/apis/src/collaboration.ts                            # wrappers for the 4 RPCs
├── apps/web/src/app/workspace/
│   ├── chat/components/MessageItem.tsx                           # menu entry + task chip
│   ├── chat/components/CreateTaskFromMessageDialog.tsx           # new
│   ├── chat/components/ChannelSidebar.tsx                        # channel destination setting
│   └── projects/[id]/tasks/[taskId]/page.tsx                     # origin block
├── apps/web/e2e/chat-task-capture.spec.ts                        # new
└── apps/mobile/
    ├── src/app/(app)/(chat)/[channelId].tsx                      # sheet entry + chip
    ├── src/components/chat/create-task-sheet.tsx                 # new
    ├── src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx        # origin block
    └── .maestro/chat-task-capture.yaml                           # new

docs/domain/
├── rituals-tasks.md                                              # tasks-from-chat, lazy resources
└── chat.md                                                       # new system event type
```

**Structure Decision**: The repository's existing three-surface layout is used unchanged —
Go backend under `backend/`, Next.js web app and Expo mobile app under `frontend/apps/`,
shared typed API wrappers under `frontend/packages/apis`. No new package or module is
introduced. The only new backend files are two logic files in `internal/collaboration`,
which is where the feature's ownership was placed by D1.

## Behavioural Contract Gate

Per Constitution principle II, [contracts/test-scenarios.md](./contracts/test-scenarios.md)
is a planning artifact that must be reviewed and approved **before** `/speckit-tasks` runs
and before any code is written. It maps all three User Stories and every user-observable
FR to named `t.Run` scenarios in `backend/integration/chat_task_capture_test.go`, plus the
Playwright and Maestro coverage. Two FRs are deliberately excluded from automated coverage
with justification recorded there.

## Risks

| Risk | Mitigation |
|---|---|
| D6 changes task-creation behaviour for every existing caller, not just chat. A client that assumes `channelId` is present immediately after `createTask` would break. | Web task detail already handles unprovisioned resources and retries. Mobile task detail must be audited for the same assumption as an explicit task; the E2E task-lifecycle suite covers the regression. |
| D5 is a breaking proto change to a widely used request. | `level_id` is only made optional, never removed, so every existing caller keeps compiling; the change is exercised by the existing `collaboration_task_test.go` suite. |
| Two people converting the same message both succeed (by design), so a message can accumulate chips. | Chips are capped with an overflow indicator; the action menu shows existing tasks before allowing a second conversion (FR-025). |
| The chip RPC could become an N+1 if wired per message component. | The contract takes `repeated message_ids` and the client calls it once per rendered page; an integration test asserts a single call resolves a page of links. |
