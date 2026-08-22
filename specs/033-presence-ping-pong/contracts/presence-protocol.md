# Contract: Presence Ping-Pong Protocol (RPC & Events)

**Feature**: 033-presence-ping-pong | **File**: `backend/rpc/v1/notification.proto`

This is a **breaking change** to the notification API. `UpdatePresenceStatus` is removed outright; there is no deprecation window. Backend, `packages/rpc`, `packages/apis`, web, and mobile ship together.

---

## 1. Removed

```protobuf
// DELETE from service NotificationService
rpc UpdatePresenceStatus(UpdatePresenceStatusRequest) returns (UpdatePresenceStatusResponse) {
  option (rpc.v1.access_control) = { required_permissions: ["notif.updatePresence"] };
}

// DELETE these messages entirely
message UpdatePresenceStatusRequest { ... }
message UpdatePresenceStatusResponse { ... }
```

Callers receive `CodeUnimplemented` from Connect once the method is gone (FR-017). Every call site in `frontend/apps/web` and `frontend/apps/mobile` is deleted in the same change set (FR-019).

## 2. Added — the pong RPC

```protobuf
// PresencePong answers a presence ping delivered on the notification stream, and is
// also sent unsolicited when the employee's state or active context changes.
//
// This is the ONLY way presence is reported. The server never advances a connection's
// liveness on its own.
//
// Cadence: the server pings every PING_INTERVAL_SECONDS (20). A connection with no pong
// for RESPONSIVE_WINDOW_SECONDS (45) is not present and not a live-delivery target.
//
// The permission key predates the protocol; it still means "may report own presence".
rpc PresencePong(PresencePongRequest) returns (PresencePongResponse) {
  option (rpc.v1.access_control) = {
    required_permissions: ["notif.updatePresence"]
  };
}

message PresencePongRequest {
  // Connection being answered for. Obtained from the connection_established event.
  // Required.
  string connection_id = 1;

  // Echo of the answered ping's NotificationEvent.event_id.
  // Empty for an unsolicited pong (state change or departure).
  // Used only for round-trip observability and duplicate suppression — liveness is
  // established by the server-observed arrival time, never by this value.
  string ping_id = 2;

  // The employee's current state on THIS connection.
  PresenceStatus status = 3;

  // Channel currently being viewed on this connection; empty when none.
  string active_channel_id = 4;

  // Client's last user-interaction time. Advisory: clamped server-side to
  // [now - 1h, now]. Never used for liveness.
  google.protobuf.Timestamp last_interaction_at = 5;

  // Clean departure: the client is going away deliberately (tab closed, signed out).
  // The connection is removed immediately rather than waiting out the window.
  bool departing = 6;
}

message PresencePongResponse {
  PongDirective directive = 1;
}

enum PongDirective {
  PONG_DIRECTIVE_UNSPECIFIED = 0;

  // Pong recorded; carry on.
  PONG_DIRECTIVE_ACK = 1;

  // This connection no longer exists server-side (removed after prolonged silence, or
  // lost to UNLOGGED-table recovery). The client MUST close its stream and re-establish.
  // A removed connection is never resurrected by a late pong.
  PONG_DIRECTIVE_RECONNECT = 2;
}
```

### Why the response carries no presence

The removed `UpdatePresenceStatusResponse` echoed status, channel, and timestamp — which forced a second `SELECT` on every call purely to build a reply the client already knew. On the hottest path in the system that is pure waste. The client is the authority on its own reported state; the server only needs to say "recorded" or "you no longer exist."

## 3. Changed — the ping event

`NotificationEvent` is **unchanged in shape**. Only the meaning of one `event_type` value changes:

| `event_type` | Before | After |
|---|---|---|
| `"heartbeat"` | server keep-alive; server also refreshed its own liveness row | **removed** |
| `"ping"` | — | **new**: a challenge. The client MUST answer with `PresencePong{ping_id: event.event_id, connection_id: <its own>}` |
| `"connection_established"` | carries `connection_id` | unchanged |
| `"notification"` | carries a `NotificationSummary` | unchanged |

The ping reuses fields that already exist:

```protobuf
NotificationEvent {
  event_id      = <UUIDv7>            // THIS IS THE PING ID — echo it in the pong
  event_type    = "ping"
  timestamp     = <server time>
  connection_id = <this connection>   // already populated on heartbeats today
}
```

No new proto field is introduced for the ping. (A `oneof payload` refactor of `NotificationEvent` would model all four event types better and is deliberately out of scope — see research R1.)

## 4. Client obligations

A conforming client MUST:

1. Record `connection_id` from `connection_established` and keep it for the life of the stream.
2. Answer **every** `ping` event with a `PresencePong` carrying the echoed `ping_id`, promptly and without user interaction.
3. Send an unsolicited pong (`ping_id` empty) when its status or active context changes materially — returning from idle, going idle, hiding presence, entering a meeting, switching channel. Debounce to at most one per 500 ms.
4. Send a pong with `departing = true` on deliberate teardown. Best-effort: if it does not land, the 45-second window covers it.
5. On `PONG_DIRECTIVE_RECONNECT`, close the stream and re-establish with the existing backoff. Do not retry the pong against the dead connection id.
6. Treat a stream that has delivered no ping for `2 × PING_INTERVAL_SECONDS` as dead and reconnect — this is how a client detects a half-open stream, and it is the client-side half of what the protocol buys.

A conforming client MUST NOT:

- Post presence on a timer of its own. Cadence is the server's to set.
- Assume a pong that returned `ACK` is durable beyond the connection's lifetime.

## 5. Error contract

| Condition | Result |
|---|---|
| Missing or malformed `connection_id` | `CodeInvalidArgument` |
| Malformed `active_channel_id` | `CodeInvalidArgument` |
| Unknown `status` (`UNSPECIFIED`) | `CodeInvalidArgument` — the client must state what it is |
| Connection belongs to another employee or organization | `PONG_DIRECTIVE_RECONNECT` — indistinguishable from removal by design, so the response leaks nothing about other tenants (FR-022, FR-023) |
| Connection not found | `PONG_DIRECTIVE_RECONNECT` (success, not an error) |
| Flush fails or times out | `CodeUnavailable` — the client simply answers the next ping |

Note the deliberate choice on row 4: an unauthorized connection id and a nonexistent one produce the identical response, so a caller cannot probe for connection ids belonging to other employees.
