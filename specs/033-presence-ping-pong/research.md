# Phase 0 Research: Presence Ping-Pong Protocol

**Feature**: 033-presence-ping-pong | **Date**: 2026-08-22

Guiding constraint from the requester: *no backward compatibility is required — this project is in early development. Prioritize performance and clean code.* Every decision below is resolved in that direction: where a compatibility-preserving option and a cleaner option existed, the cleaner one wins and the break is stated plainly.

---

## R1. Transport for challenge and answer

**Decision**: The ping travels on the **existing SSE notification stream** as a `NotificationEvent` with `event_type = "ping"`. The pong is a **new unary Connect RPC**, `PresencePong`. No new persistent transport is introduced.

**Rationale**:
- The SSE stream already exists for every signed-in client, already carries a per-connection `connection_id`, and already has a 30-second ticker we can repurpose. Sending the ping on it costs nothing new and — crucially — makes the ping *prove the stream works*, which is the whole point (see R2).
- The answer cannot travel back up the same stream: SSE is unidirectional, and Connect's browser support covers server-streaming only. A unary RPC is the only client→server direction available without adopting WebSockets.
- The ping needs no new proto field. `NotificationEvent.event_id` is already a unique UUIDv7 per event, so it *is* the ping id; the pong echoes it.

**Alternatives considered**:
- *Bidirectional streaming RPC* — the natural shape for a ping-pong protocol, but Connect bidi requires HTTP/2 trailers and is unavailable from browsers. Would have forced a browser-only fallback anyway, i.e. two protocols instead of one.
- *WebSocket transport* — genuinely bidirectional, but introduces a second connection type, a second auth path, a second reconnect strategy, and new proxy/ingress concerns, to replace a stream that already works. Rejected on both simplicity and risk.
- *A `oneof payload` refactor of `NotificationEvent`* — better modeling than the current `event_type` string plus optional fields, and tempting given no compatibility constraint. Rejected as scope creep: it touches every notification consumer in web and mobile for zero presence benefit. Worth doing on its own later.

---

## R2. Why a server challenge rather than a client self-timer

**Decision**: Liveness is established by the client **answering a server-initiated challenge**, not by the client posting on its own schedule.

**Rationale**: These look equivalent and are not. A client self-timer proves only that a JavaScript timer fired. A ping-pong proves the *entire round trip*: server → SSE stream → client → RPC → server. The dominant real failure is precisely a half-open stream — a proxy, load balancer, or mobile radio silently drops the SSE connection while the client tab keeps running and keeps believing it is connected. Under the current design that client happily posts `UpdatePresenceStatus` forever and looks perfectly online while receiving nothing. Under ping-pong it stops receiving pings, stops answering, and is correctly demoted — and, because the client also notices the missing pings, it reconnects.

This is also why the server-side `updateHeartbeat` call in the SSE loop must be **deleted**, not merely supplemented. As long as anything server-side advances the liveness timestamp, absence is unobservable.

**Alternative considered**: *Keep the server heartbeat as a floor and add pongs on top.* Rejected — it preserves exactly the bug being fixed. A connection whose client is gone would keep its floor refreshed and stay eligible for live delivery.

---

## R3. Batched pong writes with per-request result fan-out

**Decision**: Each backend instance runs a **pong batcher**. A `PresencePong` handler validates and enqueues its pong, then blocks on its own result channel. Every 200 ms (or at 500 queued pongs, whichever comes first) the batcher groups the queue **by `organization_id`** and issues one multi-row `UPDATE ... FROM unnest(...) ... RETURNING connection_id` per organization. Each waiting handler is resolved from the `RETURNING` set: present → `ACK`, absent → `RECONNECT`.

**Rationale**:
- *Performance.* At the 10k-connection target with a 20-second cadence, pongs arrive at ~500/s across the fleet. One statement per pong means ~500 writes/second against a distributed UNLOGGED table — the hottest write path in the system. Batching at 200 ms across 3 instances yields ~15 statements/second carrying ~33 rows each. The current design is worse still: a server heartbeat write (~333/s) *plus* a client `UpdatePresenceStatus` that does an ownership `SELECT`, an `UPSERT`, and a presence `SELECT` (~1000/s).
- *Correctness of the reconnect directive.* Awaiting the flush result — rather than firing and forgetting — is what lets the handler answer authoritatively that a connection no longer exists. A write-behind buffer could not.
- *No resurrection.* The batch statement is an `UPDATE`, never an upsert, so a pong arriving after the janitor removed a row cannot recreate it (spec FR-010). The unmatched row is exactly the signal that produces `RECONNECT`.
- *Constitutional standing.* Because nothing survives the request that enqueued it, the batcher is not a process-local cache and creates no cross-instance divergence. Principle XI is satisfied rather than excused.

**Cost accepted**: up to 200 ms of added latency on the pong RPC. This is a background protocol message with no user waiting on it.

**Alternatives considered**:
- *One `UPDATE` per pong* — simpler and the design degrades to exactly this when the flush window is zero, which is why it stays available as a configuration fallback. Rejected as the default purely on write volume.
- *Fire-and-forget write-behind buffer* — cheaper still, but leaves process-local state outliving its request (a real Principle XI problem) and makes `RECONNECT` undeliverable.
- *Routing every pong to the instance that owns the SSE stream* — would allow purely in-memory liveness, but requires cross-instance dispatch (LISTEN/NOTIFY or internal RPC) per pong, which costs more than the `UPDATE` it avoids and reintroduces instance affinity the constitution forbids.

---

## R4. Derive liveness from a timestamp; drop the status column

**Decision**: Delete `active_connection.connection_status`. Responsive versus unresponsive is **derived at read time** from `last_pong_at`. Removal is a single janitor `DELETE`.

**Rationale**:
- The column is redundant: `connection_status = 'active'` was always implied by a fresh heartbeat, and every existing query already carried *both* predicates side by side. Two representations of one fact that a background job had to keep in sync.
- Deleting it deletes work. `MarkStaleConnections` — an `UPDATE` over every expired row in every organization every five minutes, purely to flip a flag nobody read independently — disappears entirely. The cleanup worker collapses from mark-then-sweep to sweep.
- Reads get cheaper and, more importantly, *instantly correct*: a connection becomes unresponsive the moment the window elapses, rather than whenever the marker job next ran. Under the old design a connection could be 4 minutes 59 seconds silent and still labelled `active`.
- One column is also the entire state machine, which makes the invariant trivial to state and to test.

**Alternatives considered**:
- *Keep the column and have the sweeper maintain it* — status of the art today; rejected as redundant state plus a scheduled job to repair it.
- *Add a third status value for "unresponsive"* — the shape the spec's state machine suggests. Rejected: it would write a row per connection per transition, at fleet scale, to record something a comparison already answers for free.

---

## R5. Timing constants

**Decision**:

| Constant | Value | Meaning |
|---|---|---|
| `PING_INTERVAL_SECONDS` | 20 | Server challenges each connection this often |
| `RESPONSIVE_WINDOW_SECONDS` | 45 | A connection with no pong for longer is not present and not a live-delivery target |
| `REMOVAL_WINDOW_SECONDS` | 90 | The janitor deletes rows silent this long |

**Rationale**: 45 seconds is two missed pings plus 5 seconds of slack for network jitter and the batch window — a single dropped pong must never demote a healthy connection, but two consecutive misses is decisive. This detects a silent disappearance in 45 s against the spec's 60 s budget (SC-001), leaving headroom. Removal at 90 s is deliberately well past the responsive window so that a recovering client finds its row intact and resumes without reconnecting (spec FR-009). Traffic at 20 s is negligible: one small RPC per connection per 20 s, batched on arrival.

These are shared constants, defined in Go and mirrored in `packages/apis`, per Constitution VIII.

**Alternatives considered**: A 10 s cadence with a 25 s window would detect faster but doubles pong volume for a gain the spec does not ask for. A 60 s cadence would miss SC-001.

---

## R6. Clock authority

**Decision**: `last_pong_at` is set from the **database's** clock (`now()` inside the flush statement), never from a client- or application-supplied time. `last_interaction_at` is client-supplied, treated as advisory, and clamped in Go to `[flush_time − 1 hour, flush_time]` before it is written. Read predicates compare against `now()` in SQL.

**Rationale**: Liveness must be unforgeable and must not depend on device clock skew, which is routinely minutes off on mobile. Keeping both the write and the comparison on the database clock also avoids mixing application and database time — a hazard the current code already has, since it computes thresholds in Go and compares them against rows written with `now()`. `last_interaction_at` is only a display and idle-detection hint, so clamping an implausible value is enough.

---

## R7. Permission key

**Decision**: Keep the existing permission `notif.updatePresence` for the new `PresencePong` RPC. Do not rename it.

**Rationale**: The permission expresses "this employee may report their own presence", which is exactly what it still governs — only the protocol changed. Renaming it means a migration updating `permission` plus every `role_permission` row that references it, with no behavioral difference and a real chance of leaving a role unable to report presence. The no-backward-compatibility license makes renaming *permitted*; YAGNI (Principle V) makes it *pointless*. The one-line proto comment noting that the key predates the protocol rename is cheaper than the migration.

**Alternative considered**: `notif.reportPresence` reads better and was rejected only on cost/benefit — worth folding into an unrelated permissions cleanup if one ever happens.

---

## R8. Client architecture cleanup

**Decision**: Move presence tracking into `packages/notifications`, next to the SSE connection. Delete the `sessionStorage` connection-id handshake (`SSE_CONFIG.CONNECTION_ID_KEY`), the 1-second polling effect, the 30-second client heartbeat, and the `lastSentRef` triple-field dedup in `usePresenceTracking`.

**Rationale**: All of that machinery exists to solve one problem — the presence hook lives in a different module from the SSE hook that knows the `connection_id`, so the two coordinate through browser storage and a polling loop that checks for changes every second. Once the ping arrives *on the stream*, the code that answers it is already holding the connection id, and the entire handshake evaporates. What remains is a small module-level store holding `{status, activeChannelId, lastInteractionAt}` that the activity listeners write and the pong handler reads, plus a debounced unsolicited pong on material change.

This also removes a class of bug the current code works around explicitly: the "connection ownership error → clear stale connection_id" recovery path exists solely because `sessionStorage` can outlive the connection it describes.

**Alternative considered**: Keep the module split and pass the connection id through React context. Better than `sessionStorage`, but still couples two modules for state that only one of them needs.
