# Quickstart: Validating the Presence Ping-Pong Protocol

**Feature**: 033-presence-ping-pong

How to build, run, and prove this feature works end to end. This is a validation guide — implementation details live in `tasks.md` and the contracts.

## Prerequisites

```bash
make check-postgres          # Postgres + Citus up
make infra-up                # if it is not
```

Confirm the schema change landed:

```bash
docker compose exec postgres psql -U postgres -d tech_office_db \
  -c "\d notification.active_connection"
```

Expect `last_pong_at` present and **`connection_status` absent**. If `connection_status` is still there, the migration has not run.

## Regeneration after contract changes

The proto and SQL contracts both drive generated code; neither compiles until regenerated.

```bash
cd backend && buf generate          # proto → Go + frontend packages/rpc
cd backend && sqlc generate         # notification.query.sql → database/*.sql.go
```

A clean regeneration should delete `UpdatePresenceStatus*` from both `backend/rpc/v1/` and `frontend/packages/rpc/`. If those symbols survive, the proto edit was incomplete.

## Run the test suites

```bash
make test-backend                                   # full integration suite — must be zero failures
make test-backend-one T=TestPresencePingPong     # this feature only, while iterating
make test-frontend                                  # Playwright E2E — must be zero failures
make test-mobile                                    # Maestro flows
```

Constitution II: the feature is not done until the **entire** backend and E2E suites pass, not just the new scenarios.

## Manual end-to-end validation

These four checks correspond to the spec's headline outcomes. Run them against a local stack with the web app open and signed in.

### 1. Pings arrive and are answered (FR-001, FR-002)

Open the browser devtools Network tab. On the notification stream you should see a `ping` event roughly every 20 seconds, each followed within a second by a `PresencePong` request returning `directive: ACK`.

There should be **no** `UpdatePresenceStatus` request, ever. Its presence means a call site survived.

### 2. Liveness is not self-renewing — the core fix (FR-003, SC-001)

This is the check that would have caught the original defect. With the tab open and connected:

```bash
# watch the connection go stale while the stream is still open
docker compose exec postgres psql -U postgres -d tech_office_db -c \
  "SELECT connection_id, presence_status, now() - last_pong_at AS silent_for
     FROM notification.active_connection;"
```

Now block the pong RPC in devtools (Network → block request URL for the `PresencePong` method) while leaving the SSE stream open. Re-run the query every 15 seconds.

**Expected**: `silent_for` climbs without bound. Within 45 seconds the employee reads as offline to a colleague; by 90 seconds the janitor deletes the row.

**Failure signal**: `silent_for` resets on its own. Something server-side is still advancing the timestamp — the regression this feature exists to prevent.

### 3. Notifications reroute to push (FR-012, FR-013, SC-002)

With pongs still blocked and the connection past 45 seconds, have a colleague send the user a message. Then:

```bash
docker compose exec postgres psql -U postgres -d tech_office_db -c \
  "SELECT fallback_status, fallback_reason
     FROM notification.notification_recipient
    ORDER BY created_at DESC LIMIT 5;"
```

**Expected**: `fallback_status = 'queued'` (or `'sent'`) with `fallback_reason = 'connection_unresponsive'` — not `'recipient_online'`, which is exactly the wrong answer the old behavior produced.

### 4. Recovery without reconnecting (FR-009, SC-004)

Unblock the pong request before 90 seconds have elapsed. The next ping is answered, `silent_for` drops to near zero, and the user reads as present again — with no page reload and no new `connection_established` event on the stream. If the client reconnects instead, the responsive and removal windows are misconfigured relative to each other.

## Performance validation (SC-008)

Establish a few hundred concurrent streams against a local backend, then measure the presence write rate:

```bash
docker compose exec postgres psql -U postgres -d tech_office_db -c \
  "SELECT calls, mean_exec_time, query
     FROM pg_stat_statements
    WHERE query ILIKE '%active_connection%'
    ORDER BY calls DESC LIMIT 10;"
```

**Expected**: `RecordPresencePongs` dominates by row count but is a small fraction of the old call count — roughly one call per instance per organization per 200 ms, not one per pong. Seeing a call count that tracks the connection count 1:1 means the batcher is not batching.

Also confirm shard locality:

```sql
EXPLAIN (COSTS OFF) <the RecordPresencePongs statement>;
```

**Expected**: a single-shard plan. A plan fanning out to multiple shards means the batch was not grouped by `organization_id` (Constitution I).

## Observability spot-check (FR-025)

With the backend at debug level, one flush tick should log batch size, flush duration, matched count, and reconnect-directive count; the janitor should log removals per organization. These four numbers are what a production presence incident is diagnosed from — if any is missing, the instrumentation is incomplete.

## Rollback

The migration is forward-only, but rollback is cheap by construction: `notification.active_connection` is UNLOGGED and reconstructible. Redeploying the previous backend and frontend together, then truncating the table, returns the system to its prior behavior — clients reconnect and re-register within seconds. There is no durable state to restore.
