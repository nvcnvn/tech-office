# Tasks: Presence Ping-Pong Protocol

**Input**: Design documents from `/specs/033-presence-ping-pong/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **mandatory** here, not optional. Constitution Principle II (Scenario-First Integration & E2E Testing) is NON-NEGOTIABLE for this project: scenario stubs are composed and approved *before* implementation, and the feature is done only when the entire backend and E2E suites pass.

**Organization**: Tasks are grouped by user story. Read the increment note below before treating a checkpoint as a deploy point.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are given in every task

## Path Conventions

Web application monorepo: `backend/` (Go) and `frontend/` (pnpm workspace with `apps/web`, `apps/mobile`, shared `packages/`). All paths below are repository-relative and real.

---

## ⚠️ Increment reality — read before planning a release

This feature **replaces** an endpoint rather than adding one, so the usual "each story ships independently" promise does not hold, and pretending otherwise would mislead whoever schedules this work. Phase 2 deletes `UpdatePresenceStatus` from the proto, which breaks both clients until Phase 3 lands their replacement call. Concretely:

- **The release unit is the whole task list.** Nothing between Phase 2 and Phase 6 is deployable on its own. This is the coordinated single change set that Constitution VI requires in place of a deprecation window, and that [plan.md](./plan.md) and spec assumption A-003 already commit to.
- **The story phases remain worth keeping** as verification slices: each ends at a point where a specific group of scenarios from [contracts/integration-scenarios.md](./contracts/integration-scenarios.md) goes green, which is how you know the work is progressing correctly.
- **Read "Checkpoint" as "local validation point", never as "deploy/demo".** The template's Incremental Delivery strategy does not apply to this feature; the applicable strategy is at the end of this file.

---

## Phase 1: Setup & Behavioral Contract Approval

**Purpose**: Compose the scenario stubs that constitute the behavioral contract, and get them approved. Constitution II forbids writing implementation code before this gate.

- [X] T001 Compose backend scenario stubs in `backend/integration/presence_ping_pong_test.go` — transcribe every `t.Run` name and `// FR-XXX` traceability comment from [contracts/integration-scenarios.md](./contracts/integration-scenarios.md), each body `t.Skip("TODO: implement after scenario review")`, using the `testWorld` pattern from `backend/integration/helper_test.go`
- [X] T002 [P] Compose web E2E scenario stubs in `frontend/apps/web/e2e/presence-ping-pong.spec.ts` — six `test()` declarations from the contract's Web E2E section, each `test.skip`
- [X] T003 [P] Compose the Maestro flow stub in `frontend/apps/mobile/.maestro/presence-ping-pong.yaml` covering foreground → background → foreground presence recovery
- [X] T004 Add a `setConnectionLastPongAt` clock helper to `backend/integration/helper_test.go` that writes `last_pong_at` directly through `GlobalDbPool`, so the scenarios marked *(clock)* simulate elapsed silence instead of sleeping — the suite runs under `-timeout 120s` and cannot wait out a 90-second removal window
- [X] T005 Run `cd backend && go test -v -count=1 -run TestPresencePingPong ./integration/...`, confirm the output reads as a behavior specification, and obtain contract approval before proceeding

**Checkpoint**: Behavioral contract approved. Implementation may begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The wire format and storage substrate every story needs. Nothing user-observable happens here.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Note that the tree does **not** compile at the end of this phase — Phase 2 deletes symbols that Phase 3 replaces. That is expected and is why these two phases are not independently deployable.

### Proto contract

- [X] T006 Delete the `UpdatePresenceStatus` rpc and the `UpdatePresenceStatusRequest` / `UpdatePresenceStatusResponse` messages from `backend/rpc/v1/notification.proto`
- [X] T007 Add the `PresencePong` rpc, `PresencePongRequest`, `PresencePongResponse`, and `PongDirective` enum to `backend/rpc/v1/notification.proto` exactly as specified in [contracts/presence-protocol.md](./contracts/presence-protocol.md), including the `required_permissions: ["notif.updatePresence"]` access control option and the comment explaining why that key was kept
- [X] T008 Replace the `"heartbeat"` event-type documentation with `"ping"` on `NotificationEvent` in `backend/rpc/v1/notification.proto`, documenting that `event_id` is the ping id the client echoes
- [X] T009 Run `cd backend && buf generate` and verify no `UpdatePresenceStatus` symbol survives in either `backend/rpc/v1/` or `frontend/packages/rpc/rpc/v1/`

### Database schema

- [X] T010 In `backend/database/scripts/schema.sql`, rename `notification.active_connection.last_heartbeat` to `last_pong_at`, make it `NOT NULL`, drop the `connection_status` column and its CHECK constraint, and update the column comments to state that `last_pong_at` is advanced only by a received pong
- [X] T011 In `backend/database/scripts/schema.sql`, drop the five `connection_status`-predicated indexes and create the four replacements listed in [data-model.md](./data-model.md) (`idx_active_connection_employee_live`, `idx_active_connection_channel_live`, `idx_active_connection_expiry`, `idx_active_connection_instance`)
- [X] T012 In `backend/database/scripts/schema.sql`, add `connection_unresponsive` to the `notification.notification_recipient.fallback_reason` CHECK constraint and remove the now-unreachable `ghost_connection_timeout` value
- [X] T013 Create the forward migration `backend/k8s/base/database/migrations/20260822000001_presence_ping_pong.up.sql` mirroring T010–T012

### Database queries

- [X] T014 Delete `UpdateConnectionHeartbeat`, `UpdatePresenceStatus`, `MarkStaleConnections`, and `GetActiveConnectionByID` from `backend/database/scripts/notification.query.sql`
- [X] T015 Add `RecordPresencePongs`, `RemoveDepartedConnections`, and `DeleteExpiredConnections` to `backend/database/scripts/notification.query.sql`, copying the statements verbatim from [contracts/database-queries.md](./contracts/database-queries.md)
- [X] T016 Update the read predicates in `backend/database/scripts/notification.query.sql` — `GetEmployeeActiveConnections`, `GetActiveConnectionsByEmployeeIDs`, `GetActiveConnectionsByChannelID` switch to `last_pong_at >= now() - make_interval(secs => @responsive_window_seconds::int)`, and `InsertActiveConnection` sets `last_pong_at` on conflict
- [X] T017 Run `cd backend && sqlc generate` and confirm `backend/database/notification.query.sql.go` reflects exactly the four deletions, three additions, and four predicate changes

### Cross-stack constants (Constitution VIII)

- [X] T018 [P] In `backend/internal/notification/constants.go`, add `PingIntervalSeconds = 20`, `ResponsiveWindowSeconds = 45`, `RemovalWindowSeconds = 90`, and event-type constants `EventTypePing` / `EventTypeConnectionEstablished` / `EventTypeNotification`; add `FallbackReasonConnectionUnresponsive` and remove `FallbackReasonGhostConnectionTimeout` from the reason set
- [X] T019 [P] Mirror the timing constants and the `ping` event type into `frontend/packages/apis/src/presence.ts` and `frontend/packages/notifications/src/types.ts`, with the standard cross-stack alignment comment naming the Go file as the source of truth

**Checkpoint**: Contract and storage substrate in place. The tree does not build yet — Phase 3 restores it.

---

## Phase 3: User Story 1 — Notifications reach a colleague whose app went away silently (Priority: P1) 🎯 MVP

**Goal**: A person whose device sleeps or loses network stops counting as present, so their notifications take the push path instead of landing on an unattended screen. This is the entire business reason for the feature.

**Independent Test**: Establish a stream for a recipient, stop answering pings without any explicit departure, let the responsive window elapse, then send that recipient a notification. It must route to fallback with reason `connection_unresponsive`, and the connection must not be counted as a live target.

### Backend protocol core

- [X] T020 [US1] Create the pong batcher in `backend/internal/notification/pong_batcher.go` — `Submit(ctx, pong) (PongDirective, error)` enqueues and blocks on a per-request result channel; the flush loop fires every 200 ms or at 500 queued pongs, groups the batch **by `organization_id`** (Citus shard locality is mandatory), issues one `RecordPresencePongs` per group, and resolves each waiter to `ACK` if its connection id is in the `RETURNING` set or `RECONNECT` if it is not
- [X] T021 [US1] In `backend/internal/notification/presence_logic.go`, delete `UpdatePresenceStatus`, `UpdatePresenceParams`, and `ErrConnectionNotFound`; add `RecordPongs(ctx, tx, orgID, []PongRecord) ([]dbuuid.UUID, error)` that clamps each `LastInteractionAt` to `[now-1h, now]` and delegates to the generated `RecordPresencePongs`, plus `RemoveDepartedConnections` for the departing subset
- [X] T022 [US1] In `backend/internal/notification/presence_connect.go`, delete the `UpdatePresenceStatus` handler (including the `HasActiveConnection` re-upsert recovery path, which the `RECONNECT` directive now replaces) and add the `PresencePong` handler: extract auth, validate `connection_id` / `active_channel_id` / non-`UNSPECIFIED` status per the error contract, submit to the batcher, return the directive
- [X] T023 [US1] In `backend/internal/notification/sse.go`, rename the heartbeat ticker to a ping ticker at `PingIntervalSeconds`, emit `event_type = "ping"`, and **delete the `updateHeartbeat` call and its zero-rows re-registration branch** — this deletion is the core fix, and leaving any server-side liveness refresh in place preserves the original defect
- [X] T024 [US1] Delete the now-unused `updateHeartbeat` helper from `backend/internal/notification/notification.go` and wire the batcher's lifecycle (construction, flush goroutine start, graceful drain on shutdown) into the notification service and `backend/cmd/server.go`
- [X] T025 [US1] In `backend/internal/notification/registry.go`, replace the mark-then-sweep cleanup worker with a single `DeleteExpiredConnections` sweep per organization at `RemovalWindowSeconds`, running every 60 s

### Routing

- [X] T026 [US1] In `backend/internal/notification/routing_logic.go`, make `ShouldSendPush` treat only responsive connections as live-delivery targets, and record `connection_unresponsive` as the fallback reason when absence drove the decision; verify the single-decision-per-recipient guarantee (FR-016) still holds at the window boundary

### Clients answer the ping

- [X] T027 [P] [US1] In `frontend/packages/apis/src/presence.ts`, delete `updatePresenceStatus` and its `UpdatePresenceParams` type; add a `presencePong` wrapper behind `rpcCall` per the Constitution VII wrapper pattern
- [X] T028 [US1] In `frontend/packages/notifications/src/useSSEConnection.ts`, replace the `'heartbeat'` branch with a `'ping'` branch that answers via `presencePong` echoing `event.eventId`, closes and re-establishes the stream on `PONG_DIRECTIVE_RECONNECT`, and treats a stream silent for `2 × PING_INTERVAL_SECONDS` as dead
- [X] T029 [US1] In `frontend/apps/mobile/src/providers/notification-stream-provider.tsx`, answer `ping` events with the same directive and dead-stream handling

### Admin tooling

- [X] T030 [P] [US1] In `backend/cmd/tools.go`, remove `connection_status` from the connection-dump struct, SELECT list, and filter clause, and surface `last_pong_at` age instead

### Verify

- [X] T031 [US1] Implement the User Story 1 scenarios in `backend/integration/presence_ping_pong_test.go` — the stream/ping/pong group, the "server does not advance liveness on its own" regression guard, the routing group, the boundary group, and the two-connections group
- [X] T032 [US1] Run `make test-backend-one T=TestPresencePingPong` and confirm the User Story 1 scenarios pass

**Checkpoint**: The core defect is fixed and provable. Local validation point, not a deploy point — the clients still have dead presence-tracking code from Phase 5 to remove.

---

## Phase 4: User Story 2 — Teammates see an accurate presence indicator (Priority: P1)

**Goal**: Presence dots reflect genuine reachability, so nobody waits on a reply from someone whose app stopped answering.

**Independent Test**: Watch a viewer's presence view for a target employee, cut the target's connection without a clean shutdown, and confirm the indicator reaches offline within the detection window with no action by the viewer.

- [X] T033 [US2] In `backend/internal/notification/presence_logic.go`, update `fetchPresences`, `GetEmployeePresence`, `GetBatchEmployeePresence`, and `newOfflinePresence` to read `last_pong_at` instead of `last_heartbeat`, and confirm aggregation picks the highest-ranked `presence_status` among responsive rows only, taking context and interaction time from the most recently pongged row
- [X] T034 [US2] Rename the `LastHeartbeat` field on the `EmployeePresence` struct to `LastPongAt` in `backend/internal/notification/presence_logic.go` and update its proto mapping in `backend/internal/notification/presence_connect.go` (the `EmployeePresence.last_heartbeat` proto field keeps its name and number — only the Go-side meaning is clarified)
- [X] T035 [US2] Confirm in `backend/internal/notification/visibility_logic.go` that `FilterVisiblePresence` still runs only on the read path, so a hidden employee's routing is unaffected (FR-015); add a comment recording that ordering constraint
- [X] T036 [US2] Implement the User Story 2 scenarios in `backend/integration/presence_ping_pong_test.go` — the liveness state machine group, the recovery group, the never-resurrected group, the multi-connection aggregation group, and the appear-offline group
- [X] T037 [P] [US2] Implement the presence indicator E2E scenarios in `frontend/apps/web/e2e/presence-ping-pong.spec.ts` — appears online to a colleague, and appears offline within a minute after the stream is severed
- [X] T038 [US2] Run `make test-backend-one T=TestPresencePingPong` and confirm User Story 1 and 2 scenarios both pass

**Checkpoint**: Presence reads and routing agree on one derived predicate.

---

## Phase 5: User Story 3 — State and context reported through the pong (Priority: P2)

**Goal**: Idle, hidden, in-meeting, active-channel changes, and clean departure all travel through the pong, which is what makes this a replacement for the old endpoint rather than an addition beside it. This phase also deletes the client machinery that the old design required.

**Independent Test**: Change state and active context on a connected client and confirm the platform reflects both without any separate status-update call.

### Web client rewrite

- [X] T039 [US3] Create `frontend/packages/notifications/src/presenceState.ts` — a small module-level store holding `{status, activeChannelId, lastInteractionAt}` that activity listeners write and the pong handler reads, with a subscribe hook for the debounced unsolicited pong
- [X] T040 [US3] Rewrite `frontend/apps/web/src/hooks/usePresenceTracking.ts` against the new store: keep the visibility, focus/blur, interaction, and idle-timer detection; **delete** the 30-second heartbeat interval, the 1-second `checkConnection` polling effect, the `lastSentRef` triple-field dedup, and the connection-ownership error recovery path — all of which existed only to work around the `sessionStorage` handshake
- [X] T041 [US3] Fire a debounced (500 ms) unsolicited pong from `frontend/packages/notifications/src/useSSEConnection.ts` whenever the presence store changes materially — idle, return from idle, hidden, in-meeting, or a channel switch
- [X] T042 [US3] Send a `departing: true` pong on deliberate teardown in `frontend/apps/web/src/hooks/usePresenceTracking.ts` cleanup, fire-and-forget, documenting that a lost departure pong is covered by the responsive window
- [X] T043 [US3] Delete `CONNECTION_ID_KEY` from `frontend/packages/notifications/src/types.ts` and remove every `sessionStorage` read and write of the connection id across `frontend/apps/web` and `frontend/packages/notifications`

### Mobile client rewrite

- [X] T044 [US3] Rewrite `frontend/apps/mobile/src/hooks/use-app-state-presence.ts` to write the app-state transition into the shared presence store and let the stream provider send the unsolicited pong, removing its own `updatePresenceStatus` call and `lastSentRef` dedup
- [X] T045 [US3] Send a `departing: true` pong on sign-out and provider teardown in `frontend/apps/mobile/src/providers/notification-stream-provider.tsx`
- [X] T046 [P] [US3] Update `frontend/apps/mobile/src/hooks/use-presence.ts` and the presence query cache writes so they no longer depend on the removed endpoint's response shape

### Verify

- [X] T047 [US3] Implement the User Story 3 scenarios in `backend/integration/presence_ping_pong_test.go` — active-channel context, every supported status plus rejected `UNSPECIFIED`, unsolicited pong, departing pong, ownership and tenancy, malformed input, and the clamped-clock edge case
- [X] T048 [P] [US3] Implement the remaining web E2E scenarios in `frontend/apps/web/e2e/presence-ping-pong.spec.ts` — switching channels updates context, going idle is reflected without a reload, closing the tab marks offline promptly
- [X] T049 [P] [US3] Implement the Maestro flow in `frontend/apps/mobile/.maestro/presence-ping-pong.yaml`
- [X] T050 [US3] Run `make test-backend-one T=TestPresencePingPong` and `make test-mobile-one F=presence-ping-pong`

**Checkpoint**: The pong carries everything the removed endpoint carried, and roughly 120 lines of client coordination machinery are gone.

---

## Phase 6: User Story 4 — The old endpoint is gone (Priority: P2)

**Goal**: One source of truth for presence. No stale client can push a presence claim that contradicts what the challenge results show.

**Independent Test**: The removed operation is absent from the published contract, no call site remains in either client, and a full presence lifecycle still works end to end on both.

- [X] T051 [US4] Grep `frontend/apps/web`, `frontend/apps/mobile`, and `frontend/packages` for `updatePresenceStatus` and `UpdatePresenceStatus` and confirm zero matches outside generated output that T009 already cleared
- [X] T052 [US4] Run `cd frontend && pnpm -r typecheck` and confirm the mobile half of FR-019 is enforced by the compiler — any surviving call site fails to type-check now that the symbol is deleted from `packages/apis`
- [X] T053 [US4] Implement the removed-endpoint scenarios in `backend/integration/presence_ping_pong_test.go` — the call fails as unimplemented, and no presence record is modified
- [X] T054 [US4] Implement the presence-read compatibility scenarios in `backend/integration/presence_ping_pong_test.go` — single lookup, batch lookup, and visibility settings all unchanged from the caller's perspective (FR-020)
- [X] T055 [US4] Implement the batching and multi-instance scenarios in `backend/integration/presence_ping_pong_test.go` — every pong gets its own directive, multiple organizations in one batch, a removed connection inside a mixed batch, and connections outliving their owning instance
- [X] T056 [P] [US4] Implement the network-interception E2E scenario in `frontend/apps/web/e2e/presence-ping-pong.spec.ts` that fails if any request to the removed method leaves the browser

**Checkpoint**: All four stories' scenarios green. The change set is now internally consistent and deployable as a unit.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T057 Add the structured `slog` signals required by FR-025 in `backend/internal/notification/pong_batcher.go` and `backend/internal/notification/registry.go` — batch size, flush duration, matched count, reconnect-directive count, and janitor removals per organization; these four numbers are what a production presence incident is diagnosed from
- [X] T058 [P] Update the presence and notification architecture notes in `docs/` to describe the ping-pong protocol, the derived liveness state machine, and the batcher (Constitution XII)
- [X] T059 [P] Update `AGENTS.md`'s debugging snippet so the `active_connection` query selects `last_pong_at` rather than the dropped columns
- [X] T060 Verify shard locality: `EXPLAIN (COSTS OFF)` on `RecordPresencePongs` must show a single-shard plan, and `GetEmployeeActiveConnections` must show an index scan on `idx_active_connection_employee_live` rather than a sequential scan
- [X] T061 Run the performance validation from [quickstart.md](./quickstart.md) against a few hundred concurrent streams and confirm `RecordPresencePongs` call counts do not track connection count 1:1 — a 1:1 ratio means the batcher is not batching
- [X] T062 Walk the four manual end-to-end validations in [quickstart.md](./quickstart.md), especially check 2, which is the direct regression test for the original self-renewing-liveness defect
- [X] T063 Run `make test-backend` — the **entire** integration suite must pass, zero failures (Constitution II Definition of Done)
- [X] T064 Run `make test-frontend` — the **entire** Playwright suite must pass, zero failures
- [X] T065 Run `make test-mobile` — the **entire** Maestro suite must pass, zero failures
- [X] T066 Confirm no `t.Skip("TODO")` and no `test.skip` remain for this feature in `backend/integration/presence_ping_pong_test.go` or `frontend/apps/web/e2e/presence-ping-pong.spec.ts`

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup & Contract)** — no dependencies. Its approval gate blocks everything else.
- **Phase 2 (Foundational)** — depends on Phase 1 approval. Blocks all user stories. Leaves the tree non-compiling by design.
- **Phase 3 (US1)** — depends on Phase 2. Restores compilation. Blocks Phase 4 in practice, since US2 reads the fields US1's write path establishes.
- **Phase 4 (US2)** — depends on Phase 3.
- **Phase 5 (US3)** — depends on Phase 3 (needs a working pong endpoint). Independent of Phase 4.
- **Phase 6 (US4)** — depends on Phase 5, since the last call sites disappear there.
- **Phase 7 (Polish)** — depends on all of the above.

### Within Phase 2

Three independent tracks that can run concurrently: proto (T006–T009), schema (T010–T013), and queries (T014–T017) — though T017's `sqlc generate` needs the schema track finished first, since sqlc reads `schema.sql`. Constants (T018, T019) depend on nothing and can start immediately.

### Within Phase 3

T020 → T021 (the handler needs the batcher) → T024 (lifecycle wiring needs both). T022, T025, T026, T027, T030 are independent of that chain. T028 and T029 both depend on T027. T031 depends on everything before it.

### Story dependencies

Unlike a typical feature, these stories are **sequentially dependent**, because they are slices of one protocol replacement rather than separable capabilities. US2 reads what US1 writes; US4 removes what US3 stops using. Do not plan for parallel story ownership without accepting merge coupling in `presence_logic.go` and `presence_connect.go`.

### Parallel opportunities

- **Phase 1**: T002 and T003 in parallel with T001
- **Phase 2**: the three tracks above, plus T018 and T019 at any time
- **Phase 3**: T027 and T030 alongside the backend core chain
- **Phase 5**: T046 alongside the web rewrite; T048 and T049 alongside T047
- **Phase 7**: T058 and T059 alongside the verification tasks

---

## Parallel Example: Phase 2 Foundational

```bash
# Three independent tracks, one developer each:
Track A (proto):   T006 → T007 → T008 → T009
Track B (schema):  T010 → T011 → T012 → T013
Track C (queries): T014 → T015 → T016   # then T017 once Track B lands

# And immediately, independent of all three:
Task: "T018 Add timing and event-type constants in backend/internal/notification/constants.go"
Task: "T019 Mirror constants in frontend/packages/apis/src/presence.ts"
```

---

## Implementation Strategy

### The applicable strategy: one change set, validated in slices

The template's MVP-first and Incremental-Delivery strategies assume stories ship separately. They do not apply here — see the increment note at the top. Use this instead:

1. **Get the contract approved** (Phase 1). Everything downstream is cheap to redirect at this point and expensive later.
2. **Land the substrate** (Phase 2) knowing the tree will not build until Phase 3.
3. **Fix the defect first** (Phase 3). This is the highest-value slice: the moment T023's deletion lands with T020–T022, the "sleeping laptop looks online" bug is gone. Validate it with check 2 of the quickstart before going further.
4. **Work outward** through Phases 4–6, running `make test-backend-one T=TestPresencePingPong` at each checkpoint.
5. **Merge as one change set** after Phase 7's full suites pass. Constitution VI is satisfied by the change being atomic across proto, backend, web, and mobile — not by keeping the old surface alive.

### If work must be split across people

Phase 2's three tracks parallelize cleanly. After that, the honest split is backend (T020–T026, T031) and clients (T027–T029, T039–T046), with the client developer blocked until T021 lands the endpoint they call. Two developers is the useful maximum; a third would contend on the same two Go files.

### Rollback

Cheap by construction, as recorded in [quickstart.md](./quickstart.md): `notification.active_connection` is UNLOGGED and reconstructible, so redeploying the previous backend and frontend together and truncating the table returns the system to its prior behavior within seconds. There is no durable state to restore.

---

## Notes

- `[P]` marks tasks touching different files with no incomplete dependencies
- `[Story]` labels map tasks to spec user stories for traceability
- Scenario stubs are written and approved before implementation, per Constitution II — this is the one ordering rule in this file that is non-negotiable
- Commit after each task or logical group
- The single most important line in this list is T023's deletion of the server-side liveness refresh; every other task supports it
