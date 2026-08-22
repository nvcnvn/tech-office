# Implementation Plan: Presence Ping-Pong Protocol

**Branch**: `033-presence-ping-pong` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/033-presence-ping-pong/spec.md`

## Summary

Presence is currently self-reported and, worse, self-renewing: the SSE loop refreshes `last_heartbeat` on its own 30-second ticker ([sse.go:137](../../backend/internal/notification/sse.go#L137)) whether or not anyone is on the other end, and the client separately posts `UpdatePresenceStatus` every 30 seconds. A sleeping laptop therefore stays "online" for minutes, and `ShouldSendPush` ([routing_logic.go:164](../../backend/internal/notification/routing_logic.go#L164)) suppresses the push that would have reached the person.

The fix is a challenge-response protocol carried entirely on connections that already exist:

- **Ping** — the server emits a `ping` event on the existing SSE stream (replacing the `heartbeat` event). Its `event_id` (UUIDv7) *is* the ping id; no new proto field.
- **Pong** — the client answers with a new unary RPC `PresencePong`, carrying its status, active context, last interaction, and the echoed ping id. A pong is also sent unsolicited on any state change and on clean departure.
- **Liveness** — `active_connection.last_pong_at` is advanced *only* by a received pong. Nothing server-side ever refreshes it.

Three deliberate simplifications come with it, all enabled by the "no backward compatibility" constraint:

1. **The state machine becomes one column.** `connection_status` ('active'/'stale') is dropped; responsive/unresponsive is *derived* from `last_pong_at` at read time, and removal is a single janitor `DELETE`. The two-phase mark-then-sweep in [registry.go:106](../../backend/internal/notification/registry.go#L106) disappears.
2. **Pong writes are batched.** A request-scoped batcher coalesces pongs arriving at an instance into one multi-row `UPDATE` per organization per flush tick (200 ms). Each waiting RPC gets its own answer from the `RETURNING` set, so a pong for a removed connection synchronously receives a `RECONNECT` directive.
3. **The client's presence machinery collapses.** The `sessionStorage` connection-id handshake, the 1-second polling loop, and the 30-second client heartbeat in [usePresenceTracking.ts](../../frontend/apps/web/src/hooks/usePresenceTracking.ts) are all deleted — presence tracking moves next to the SSE connection that already owns the connection id.

Net effect at 10k concurrent connections: from roughly 1,300 presence-related statements/second to roughly 15, while cutting detection of a silent disappearance from "minutes" to 45 seconds.

## Technical Context

**Language/Version**: Go 1.25.0 (backend); TypeScript 5.x on Next.js 15.5 / React 19 (web); Expo ~55 / React Native (mobile)
**Primary Dependencies**: Connect RPC (`connectrpc.com/connect`), protobuf + buf, pgx v5, sqlc (custom `sqlc-gen-go-crud` wasm plugin), TanStack Query
**Storage**: PostgreSQL with Citus distributed tables; `notification.active_connection` is an UNLOGGED distributed table sharded on `organization_id`
**Testing**: Go integration tests in `backend/integration/` (`testWorld` pattern); Playwright E2E in `frontend/apps/web/e2e/`; Maestro flows in `frontend/apps/mobile/.maestro/`
**Target Platform**: Linux backend pods (minimum 3 instances behind a load balancer), evergreen browsers, iOS/Android via Expo
**Project Type**: Web application + mobile client over a shared Connect RPC API
**Performance Goals**: ≤ 20 DB statements/second for presence at 10k concurrent connections; pong RPC p95 < 250 ms (dominated by the 200 ms batch window); no added latency on the notification delivery path
**Constraints**: Every presence query shard-local (`organization_id` in the predicate); no process-local state that outlives a request; UNLOGGED table data loss on crash must remain acceptable; detection of silent disappearance ≤ 45 s (spec SC-001 allows 60 s)
**Scale/Scope**: 10k concurrent connections as the design target; ~2–4 connections per active employee (tabs + phone); backend, web, and mobile change together in one release

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see [Post-Design Re-check](#post-design-constitution-re-check).*

| Principle | Applies? | How this design complies |
|---|---|---|
| **I. Data Governance & Citus Sharding** | Yes | Every read and write carries `organization_id`. The pong batcher groups by organization so each flush statement is shard-local; a cross-organization multi-row update is explicitly forbidden by the batcher's design. `active_connection` remains distributed and colocated with `public.organization`. |
| **II. Scenario-First Integration & E2E Testing** | Yes | Scenario stubs derived from every User Story and user-observable FR are composed in [contracts/integration-scenarios.md](./contracts/integration-scenarios.md) and must be approved before `/speckit-tasks`. Backend scenarios land in `backend/integration/presence_ping_pong_test.go`; web behavior in `frontend/apps/web/e2e/`; mobile happy path as a Maestro flow. |
| **III. Two-Layer Architecture & Proto Authorization** | Yes | `PresencePong` declares `required_permissions: ["notif.updatePresence"]` in the proto. The connect layer owns the pool, auth extraction, and the batcher; `PresenceLogic.RecordPongs` stays pool-agnostic and takes `tx database.DBTX`. |
| **IV. Cross-Domain Integration** | Yes | Chat/voice/calendar consume presence only through `PresenceLogic` and `RoutingLogic`; those interfaces keep their shape. `in_meeting` set by voice remains a valid pong status. |
| **V. Observability, Simplicity & YAGNI** | Yes | Net deletion of code: one column, one query (`MarkStaleConnections`), one query (`UpdateConnectionHeartbeat`), one RPC, and ~120 lines of client polling all removed. Structured `slog` counters cover pong receipt, batch size, reconnect directives, and janitor removals. |
| **VI. Versioning & Breaking Changes** | Yes | Intentional breaking change, shipped as one coordinated change set across proto, backend, web, and mobile — the mechanism the constitution accepts in place of a deprecation window. |
| **VII. Frontend API Wrapper Pattern** | Yes | `presencePong` is added to `packages/apis/src/presence.ts` behind `rpcCall`; `updatePresenceStatus` and its types are deleted. No component calls the RPC client directly. |
| **VIII. Cross-Stack Constant Synchronization** | Yes | `PING_INTERVAL_SECONDS`, `RESPONSIVE_WINDOW_SECONDS`, `REMOVAL_WINDOW_SECONDS`, and the `ping` event type are defined in Go, mirrored in `packages/apis`, and referenced from the proto comments — all in the same PR, per the principle's checklist. |
| **IX. UUID v7 & Nullable Cursor Params** | Yes | Ping ids reuse the existing UUIDv7 `NotificationEvent.event_id`. No new pagination. |
| **X. Structured Error Details** | Yes | `PresencePong` returns `CodeInvalidArgument` for a malformed connection id and a `PONG_DIRECTIVE_RECONNECT` result (not an error) for an unknown connection — a normal protocol outcome, not a failure. |
| **XI. Distributed-First & Horizontal Scalability** | Yes — closest call | The batcher holds only *in-flight* requests: nothing outlives the RPC that created it, so it is not a process-local cache and no state is lost on instance death beyond requests that were failing anyway. The DB remains the single source of truth. See [Complexity Tracking](#complexity-tracking). |
| **XII. Architecture Documentation** | Yes | `docs/` presence/notification architecture notes updated in the same change set. |
| **XIII. Mobile Design & Testing (Expo + Maestro)** | Yes | Mobile pong handling lands in `notification-stream-provider`; a Maestro flow covers foreground → background → foreground presence. |

**Gate result: PASS.** No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/033-presence-ping-pong/
├── plan.md                          # This file
├── spec.md                          # Feature specification
├── research.md                      # Phase 0 output — decisions and rejected alternatives
├── data-model.md                    # Phase 1 output — schema and state machine
├── quickstart.md                    # Phase 1 output — how to run and validate
├── contracts/
│   ├── presence-protocol.md         # Proto delta: ping event, PresencePong RPC
│   ├── database-queries.md          # sqlc query delta
│   └── integration-scenarios.md     # Behavioral contract (Constitution II gate)
├── checklists/
│   └── requirements.md              # Spec quality checklist
└── tasks.md                         # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── notification.proto                  # −UpdatePresenceStatus rpc/messages; +PresencePong; ping event docs
├── database/scripts/
│   ├── schema.sql                          # active_connection: −connection_status, last_heartbeat→last_pong_at
│   └── notification.query.sql              # −UpdatePresenceStatus, −UpdateConnectionHeartbeat, −MarkStaleConnections
│                                           # +RecordPresencePongs, +RemoveDepartedConnections, ~read predicates
├── internal/notification/
│   ├── sse.go                              # heartbeat→ping event; DELETE the self-refresh write
│   ├── presence_logic.go                   # −UpdatePresenceStatus; +RecordPongs; +Ping/removal windows
│   ├── presence_connect.go                 # −UpdatePresenceStatus handler; +PresencePong handler
│   ├── pong_batcher.go                     # NEW — per-instance request-scoped write coalescer
│   ├── constants.go                        # +timing constants, +event type constants
│   ├── registry.go                         # cleanup worker collapses to a single DELETE sweep
│   └── routing_logic.go                    # responsiveness drives live-vs-fallback; fallback reason recorded
├── cmd/tools.go                            # admin connection dump: drop connection_status column
└── integration/
    └── presence_ping_pong_test.go          # NEW — behavioral contract

frontend/
├── packages/rpc/rpc/v1/notification_pb.ts  # regenerated
├── packages/apis/src/presence.ts           # −updatePresenceStatus; +presencePong; +timing constants
├── packages/notifications/src/
│   ├── useSSEConnection.ts                 # 'heartbeat' branch → 'ping' branch that answers
│   ├── presenceState.ts                    # NEW — tiny in-module store the pong reads from
│   └── types.ts                            # −CONNECTION_ID_KEY sessionStorage handshake
├── apps/web/src/hooks/usePresenceTracking.ts  # rewritten: no polling, no heartbeat, no sessionStorage
├── apps/web/e2e/                           # presence E2E scenarios
├── apps/mobile/src/providers/notification-stream-provider.tsx  # ping → pong
├── apps/mobile/src/hooks/use-app-state-presence.ts             # rewritten to unsolicited pongs
└── apps/mobile/.maestro/                   # presence flow
```

**Structure Decision**: Existing web-application layout (`backend/` + `frontend/` monorepo with shared `packages/rpc` and `packages/apis`). No new top-level directories. One new backend file (`pong_batcher.go`) and one new frontend module (`presenceState.ts`); everything else is modification or deletion of existing files.

## Phase 0: Research

See [research.md](./research.md). Decisions resolved:

- **R1** — Ping on the existing SSE stream, pong as a unary RPC (bidi streaming is not available to browsers through Connect).
- **R2** — Why server-initiated challenge beats a client self-timer: it proves the whole server→client→server path, not just that a JS timer fired.
- **R3** — Batched pong writes with per-request result fan-out, sized and justified against the 10k-connection target.
- **R4** — Derive responsive/unresponsive from `last_pong_at` instead of storing a status column.
- **R5** — Timing constants: ping 20 s, responsive window 45 s, removal window 90 s.
- **R6** — Client clocks are advisory: `last_pong_at` is server-observed; `last_interaction_at` is clamped.
- **R7** — Keep the `notif.updatePresence` permission key; renaming it costs a permission/role migration for no behavioral gain.

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md) — `active_connection` schema delta, the derived liveness state machine, aggregation rules, and the migration.
- [contracts/presence-protocol.md](./contracts/presence-protocol.md) — proto delta, ping event shape, `PresencePong` request/response, directive semantics, client obligations.
- [contracts/database-queries.md](./contracts/database-queries.md) — sqlc query delta including the batched `RecordPresencePongs` statement.
- [contracts/integration-scenarios.md](./contracts/integration-scenarios.md) — **behavioral contract requiring approval before `/speckit-tasks`** (Constitution II).
- [quickstart.md](./quickstart.md) — regeneration, migration, and end-to-end validation steps.

## Post-Design Constitution Re-check

Re-evaluated after the Phase 1 artifacts were written. No principle moved from PASS.

Two points were tightened during design:

1. **Citus shard locality (I)** — the first sketch of `RecordPresencePongs` batched across organizations, which would have been a cross-shard write. The contract now requires grouping by `organization_id`, with `organization_id` as a scalar predicate and the per-connection values passed as parallel arrays through `unnest`. One statement per (instance, organization, flush tick).
2. **Statelessness (XI)** — the batcher was initially designed as a fire-and-forget write-behind buffer, which *would* have been process-local state outliving its request and would have made the `RECONNECT` directive undeliverable. Making each pong RPC await its own flush result removed both problems at the cost of ≤ 200 ms of latency on a non-interactive call.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Per-instance pong batcher (`pong_batcher.go`) rather than one `UPDATE` per pong | At 10k connections a direct-write design issues ~500 statements/second against a distributed UNLOGGED table, on the hottest path in the system. Batching cuts that by ~30× and is the single largest performance lever in this feature. | A direct write per pong is simpler but wastes the dominant share of presence DB budget. It remains the exact degenerate case of this design (flush window → 0), so the batcher can be disabled by configuration if it ever misbehaves. |
| Batcher holds in-flight requests in process memory (brushes Principle XI) | Every batched-write design must hold the pending batch somewhere for the duration of the flush window. | Not applicable — the alternative is no batching. The constitutional concern (state that outlives a request and diverges across instances) does not arise: nothing in the batcher survives the RPC that put it there, and the database stays the sole source of truth. |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A misbehaving or old client never answers pings | Person shows offline and always gets push | Both clients ship in the same release; the integration and E2E suites cover the answer path, and the janitor's removal counter surfaces an anomalous rate. |
| Batch flush latency masks a slow database | Pong p95 climbs, presence lags | Flush duration and batch size are logged per tick; a flush that exceeds the window logs a warning. |
| A clean-departure pong is lost on page unload | Person lingers as present for up to 45 s | Accepted: this is the exact case the responsive window exists for, and it is strictly better than today's minutes-long lingering. |
| `active_connection` truncated by PostgreSQL recovery (UNLOGGED) | All connections vanish at once | Unchanged from today: the next pong for a missing row returns `RECONNECT`, and clients re-establish with existing backoff. The re-register-on-heartbeat hack in `sse.go` is deleted in favor of this single path. |
