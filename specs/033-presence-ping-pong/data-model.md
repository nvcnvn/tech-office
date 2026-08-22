# Phase 1 Data Model: Presence Ping-Pong Protocol

**Feature**: 033-presence-ping-pong | **Date**: 2026-08-22

## Overview

One table changes: `notification.active_connection`. It stays an UNLOGGED Citus distributed table sharded on `organization_id` and colocated with `public.organization`. The change is a net simplification — one column renamed to carry a stronger guarantee, one column and one CHECK constraint deleted.

Nothing else in the presence domain changes shape: `notification.presence_visibility`, `notification.push_token`, and the notification tables are untouched.

## `notification.active_connection` — schema delta

| Column | Before | After | Note |
|---|---|---|---|
| `employee_id` | `uuid NOT NULL` | unchanged | |
| `organization_id` | `uuid NOT NULL` | unchanged | shard key |
| `connection_id` | `uuid NOT NULL` | unchanged | one row per live client session |
| `instance_id` | `text NOT NULL` | unchanged | instance that owns the SSE stream |
| `department_ids` | `uuid[]` | unchanged | denormalized, set on connect |
| `connected_at` | `timestamptz DEFAULT now()` | unchanged | |
| `last_heartbeat` | `timestamptz DEFAULT now()` | **renamed → `last_pong_at timestamptz NOT NULL DEFAULT now()`** | semantics change: advanced **only** by a received pong |
| `connection_status` | `text DEFAULT 'active' CHECK (IN ('active','stale'))` | **dropped** | liveness is derived from `last_pong_at` |
| `presence_status` | `text NOT NULL DEFAULT 'online'` | unchanged | set from each pong |
| `active_channel_id` | `uuid NULL` | unchanged | set from each pong |
| `last_interaction_at` | `timestamptz NOT NULL DEFAULT now()` | unchanged | client-supplied, clamped |
| `device_identifier` | `text NOT NULL DEFAULT ''` | unchanged | |
| `user_agent`, `ip_address` | `text`, `inet` | unchanged | |

Primary key `(organization_id, employee_id, connection_id)` and both foreign keys are unchanged.

### The rename is not cosmetic

`last_heartbeat` meant "something touched this row recently" — and the SSE loop touched it on a server-side ticker, which is the defect. `last_pong_at` means "a client answered a challenge at this instant, observed by the database clock." Every write site that is not a pong is deleted along with the old name, which is why the rename is worth doing rather than reusing the column in place: the compiler and sqlc find every caller.

### Index delta

Dropped (all predicated on the removed column):
- `idx_active_connection_employee` — `(organization_id, employee_id, connection_status)`
- `idx_active_connection_instance` — `(organization_id, instance_id, connection_status)`
- `idx_active_connection_org` — `(organization_id, connection_status)`
- `idx_active_connection_org_presence` — `(organization_id, presence_status, last_heartbeat DESC)`
- `idx_active_connection_heartbeat` — partial `WHERE connection_status = 'active'`

Created:
- `idx_active_connection_employee_live` — `(organization_id, employee_id, last_pong_at DESC)` — serves presence lookups and routing eligibility, the two hottest reads
- `idx_active_connection_channel_live` — `(organization_id, active_channel_id, last_pong_at DESC) WHERE active_channel_id IS NOT NULL` — serves channel-scoped live routing
- `idx_active_connection_expiry` — `(organization_id, last_pong_at)` — serves the janitor sweep
- `idx_active_connection_instance` — `(organization_id, instance_id)` — serves instance-startup cleanup

Retained unchanged:
- `idx_active_connection_departments` — GIN on `department_ids`

Five partial/compound indexes become four plain ones on a table whose every row is rewritten every 20 seconds; fewer indexes on a write-hot UNLOGGED table is a direct write-throughput gain.

### Migration

Forward-only, in `backend/k8s/base/database/migrations/`, and mirrored into `backend/database/scripts/schema.sql` (which is sqlc's schema source):

```sql
ALTER TABLE notification.active_connection RENAME COLUMN last_heartbeat TO last_pong_at;
ALTER TABLE notification.active_connection ALTER COLUMN last_pong_at SET NOT NULL;
ALTER TABLE notification.active_connection DROP COLUMN connection_status;
-- drop the five obsolete indexes, create the four listed above
```

No data migration and no down-migration data concern: the table is UNLOGGED and explicitly documented as reconstructible by client reconnection. Rows present at deploy time are simply swept by the janitor if their clients do not pong.

## Derived liveness state machine

There is no stored state. Given `age = now() - last_pong_at`:

```
    row created (SSE connect, last_pong_at = now())
                 │
                 ▼
         ┌───────────────┐   pong received      ┌───────────────┐
         │  RESPONSIVE   │◀─────────────────────│ UNRESPONSIVE  │
         │ age ≤ 45 s    │                      │ 45 s < age    │
         │               │──────────────────────▶│      ≤ 90 s  │
         └───────────────┘   no pong for 45 s   └───────────────┘
                 │                                      │
                 │ departing pong (immediate DELETE)    │ no pong for 90 s
                 ▼                                      ▼
         ┌──────────────────────────────────────────────────────┐
         │  REMOVED — row deleted; a later pong returns RECONNECT │
         └──────────────────────────────────────────────────────┘
```

| Transition | Trigger | Mechanism |
|---|---|---|
| → RESPONSIVE | connection established, or any pong | `InsertActiveConnection`, or `RecordPresencePongs` setting `last_pong_at = now()` |
| RESPONSIVE → UNRESPONSIVE | 45 s elapse with no pong | none — the read predicate stops matching |
| UNRESPONSIVE → RESPONSIVE | any pong before removal | `RecordPresencePongs` (FR-009: no re-auth, no reconnect) |
| UNRESPONSIVE → REMOVED | 90 s elapse with no pong | janitor `DeleteExpiredConnections`, every 60 s |
| RESPONSIVE → REMOVED | clean departure | `RemoveDepartedConnections` in the same flush |
| REMOVED → (nothing) | late pong | `UPDATE` matches 0 rows → handler returns `RECONNECT` (FR-010) |

**Invariant**: a connection is a valid live-delivery target **iff** `last_pong_at >= now() - 45s`. Exactly one predicate, used identically by presence reads and routing.

## Aggregation to a person's presence

Unchanged in shape from today, restated because the inputs changed (FR-011):

1. Select the employee's rows where `last_pong_at >= now() - 45s`.
2. No rows → offline.
3. Otherwise the reported status is the **highest-ranked** `presence_status` among them, using the existing `presenceStatusPriority` ladder: `online` (4) > `online_hidden` (3) = `in_meeting` (3) > `idle` (2) > `offline` (1).
4. `active_channel_id` and `last_interaction_at` come from the most recently pongged responsive row.
5. `PresenceVisibility` is applied *after* aggregation, on the read path only — it never affects routing (FR-015).

## Entity mapping — spec to implementation

| Spec entity | Where it lives |
|---|---|
| Connection | one `notification.active_connection` row |
| Challenge (ping) | a transient `NotificationEvent{event_type: "ping"}`; never persisted. Its `event_id` is the ping id |
| Answer (pong) | a transient `PresencePongRequest`; never persisted. Its effect is the field update on the connection row |
| Person's presence | derived, not stored — computed by `PresenceLogic` from the employee's responsive rows |
| Presence visibility preference | `notification.presence_visibility` — unchanged |
| Routing decision record | `notification.notification_recipient.fallback_status` / `fallback_reason` — unchanged columns, one new reason value |

## Constant and enum alignment (Constitution VIII)

| Value | Go | SQL | Proto | TypeScript |
|---|---|---|---|---|
| presence statuses | `constants.go` | `presence_status_valid` CHECK | `PresenceStatus` enum | `packages/apis/src/presence.ts` |
| `PING_INTERVAL_SECONDS = 20` | `constants.go` | — | proto comment | `packages/apis/src/presence.ts` |
| `RESPONSIVE_WINDOW_SECONDS = 45` | `constants.go` | query parameter | proto comment | `packages/apis/src/presence.ts` |
| `REMOVAL_WINDOW_SECONDS = 90` | `constants.go` | query parameter | proto comment | not needed client-side |
| SSE event type `"ping"` | `constants.go` | — | `NotificationEvent.event_type` doc | `packages/notifications/src/types.ts` |

The windows are passed to SQL as integer seconds via `make_interval(secs => $n)` so the value has exactly one definition (Go) and the comparison still runs on the database clock.

### New fallback reason

`notification.notification_recipient.fallback_reason` gains `connection_unresponsive`, alongside the existing `ghost_connection_timeout` (which becomes unreachable and is removed in the same change set — it was the workaround for the defect this feature fixes). This satisfies FR-014's requirement that the routing decision stay auditable.
