# Platform

Cross-cutting mechanics every domain depends on: how a request is authenticated and
authorised, how tenant data stays separated, how background work runs, and how the whole
thing is tested.

**Status date: 2026-08-28.**

## Shape

A single Go binary (`backend/cmd`) serving Connect-RPC over HTTP/1.1 and h2c, backed by
one PostgreSQL cluster running Citus. The frontend is a pnpm workspace with a Next.js web
app, an Expo mobile app, and shared packages (`apis`, `rpc`, `notifications`, `links`,
`theme-tokens`, `validations`).

```
Client (web / mobile)
  │  Connect-RPC (+ SSE for the notification stream)
  ▼
AccessLogInterceptor → AuthInterceptor (JWT verify + permission check)
  ▼
Connect layer   (per domain: owns pools, proto↔DB conversion, transactions)
  ▼
Logic layer     (per domain: business rules, pool-agnostic, injected as interfaces)
  ▼
sqlc queries → PostgreSQL + Citus
```

The two-layer split (Connect layer / Logic layer) is Constitution principle III. Logic
constructors never take a pool; they take `database.DBTX` per call so the Connect layer
decides transaction scope.

## Multi-tenancy

Tenant isolation is **application-enforced, not RLS-enforced**.

- Nearly every table carries `organization_id` and a composite primary key
  `(organization_id, id)`, and is distributed with
  `create_distributed_table(..., 'organization_id', colocate_with => 'public.organization')`.
  Colocation is what lets multi-table joins stay single-shard.
- Reference tables (`public.permission`, `public.default_role`,
  `public.default_role_permission`, `notification.active_listener`) are replicated to every
  worker instead of sharded.
- Global, non-distributed tables: `iam.user`, `iam.sso_identity`, `iam.password_credential`,
  `iam.session`, `iam.password_reset_token`. A user is global; membership is per-org.
- `iam.user.id`, `iam.identity.id` and `organization.employee.id` are **the same UUID** for
  a person. There is no user↔organization mapping table; enumerating somebody's
  memberships is `SELECT organization_id FROM iam.identity WHERE id = $1`, which has no
  `organization_id` predicate and so must run on `AdminPool`.
- Every foreign key across schemas is composite and leads with `organization_id`.

Two pools, both in `backend/database/pool.go`:

| Pool | `BeforeAcquire` | Used for |
|---|---|---|
| `TenantPool` | refuses the connection unless the request context carries an org ID | ordinary request handling |
| `AdminPool` | always allows | cross-org work: background jobs, permission lookup, the janitor sweeps, migrations |

`TenantPool` does **not** set a session variable or apply RLS. It only asserts that an
authenticated org context exists; the `organization_id` predicate in each query is what
actually scopes the data. A query that forgets it is a tenant leak, and no database-level
backstop will catch it.

## Authentication and authorization

`internal/interceptor/auth.go` does both in one pass, driven by the proto schema.

Every RPC declares its requirement inline via the `rpc.v1.access_control` option
(`rpc/v1/rbac.proto`):

```proto
rpc SendMessage(SendMessageRequest) returns (SendMessageResponse) {
  option (rpc.v1.access_control) = { required_permissions: ["chat.sendMessage"] };
}
```

Semantics:

- `required_permissions` is **OR** — any one of the listed permissions grants access.
- Empty list + `allow_unauthenticated: false` means "any authenticated user".
- `allow_unauthenticated: true` bypasses both checks.
- **A method with no `access_control` option at all is denied.** Fail-safe by default.
- On an `allow_unauthenticated` method, a token that *is* present is still verified. An
  unverified token is never accepted as context, so handlers can trust what they read.

Both `WrapUnary` and `WrapStreamingHandler` implement this, so the SSE notification stream
is authorised on the same rules as unary calls.

Tokens are internal JWTs signed by `iam.InternalJWTSigner` (RSA key from
`JWT_PRIVATE_KEY_PATH`; an ephemeral key is generated with a warning when unset — dev
only). Permissions are resolved per request by `iam.PermissionLookup` against the
`AdminPool`, because role/permission rows must be readable regardless of tenant context.

The permission catalogue itself lives in `public.permission` (~95 rows, `<domain>.<action>`
format) and is seeded by migration. See [auth-identity.md](auth-identity.md) for the role
model layered on top.

## Background jobs

Durable background work runs on `github.com/nvcnvn/flows`, a Postgres-backed workflow
engine using the `flows` schema (`runs`, `steps`, `waits`, `events`, `random`, `schedules`)
sharded by `FLOW_SHARD_COUNT`. One `flows.Worker` polls every second inside the server
process.

Registering a workflow only makes it *resolvable*. `flows.ScheduleTx` is what makes it
*run*, and it upserts by schedule ID, so every instance and every restart converges on one
row rather than multiplying schedules.

| Workflow | Cadence | Purpose |
|---|---|---|
| `ritual_generation_sweep` | every 1 min | one platform-wide pass generating due ritual instances for all orgs (Feature 034) |
| `CalendarReminderWorkflow` | every 1 min | polls due `calendar.event_reminder` rows and publishes reminders |
| `FileValidation` | on demand, concurrency 9 | MIME sniffing + ClamAV scan after upload |
| `FilePostProcessing` | on demand | PDF conversion / content indexing (partly skeleton) |
| `compliance-account-deletion/v1` | on demand | resumable account erase, one run per organization the deleted person belongs to |

Non-flows goroutines started by `notificationService.Start()` and the server: the SSE
LISTEN consumer, the stale-connection janitor (30 s), the push-token cleanup (24 h), the
rescue push worker (1 s), the presence pong batcher, the voice **ring timeout sweep**
(1 s), and the **call wake sender**.

Two of those are worth knowing about individually:

- **Ring timeout sweep** (`internal/voice/ring_timeout.go`) ends calls nobody answered.
  It runs on every instance, and its claim and its end are a *single* UPDATE, so two
  instances sweeping the same call serialise on the row and only one of them sees it — a
  call is ended exactly once without a lock table or a leader.
- **Call wake sender** (`internal/notification/call_wake.go`) drains a bounded in-process
  queue of per-device call wakes. It exists so APNs and Firebase I/O never happens on a
  request goroutine, which would put it inside the caller's transaction. A saturated queue
  drops wakes with an audit row rather than blocking, because a call wake delivered after
  its ring deadline is worse than none.

**Pickup latency.** The worker polls one shard per workflow per tick, round-robin across
`FLOW_SHARD_COUNT` (32 by default) at one second. A freshly enqueued run therefore waits
up to ~32 seconds before anyone looks at its shard. That is fine for work with no
interactive latency target — the account erase is the clearest case, because the person is
signed out synchronously before it is queued — and it is why tests that wait on background
work budget for the whole rotation rather than the lucky case.

## Configuration

`internal/config` reads from the environment. The settings that change behaviour rather
than just endpoints:

| Variable | Effect when unset |
|---|---|
| `JWT_PRIVATE_KEY_PATH` | ephemeral signing key — all tokens die on restart |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | SSO token **audience validation is disabled** (logged as dev-only) |
| `GOOGLE_APPLICATION_CREDENTIALS` | FCM client not built — **push notifications silently disabled** |
| `APNS_VOIP_*` | APNs VoIP client not built — iOS calls fall back to the alert ring instead of presenting as system calls. A *partially* set credential fails startup rather than degrading, because that is a deployment mistake and not an opt-out. See `backend/docs/APNS-VOIP-SETUP.md`. |
| `R2_*` | file storage unavailable |
| `LIVEKIT_*` | voice falls back to dev defaults (`ws://localhost:7880`, `devkey`) |
| `SES_*` | email sender logs instead of sending |

CORS is currently `cors.AllowAll()`.

Operational endpoints outside the RPC surface: `/healthz` (k8s probes),
`/api/internal/status` (detailed JSON), `/api/notifications/stream` (raw SSE for
`EventSource` clients), `/api/livekit/webhook`, and `/api/linking/{generate,resolve,preview}`.

## Schema and migrations

- `backend/database/migrations/` holds the ordered, forward-only migrations. They are the
  single source of truth for the schema: they build every database, and sqlc reads them.
  The runner (`backend/scripts/migrate.sh`) does not support `down`, so migrations are
  `.up.sql` only.
- `backend/database/scripts/schema.sql` is a **generated** read-only snapshot — the whole
  schema as one file, for reading. Consult it first when debugging; never hand-edit it.
  Regenerate with `backend/scripts/regen-schema.sh`, which applies the migrations to a
  throwaway database and dumps the result, so it cannot disagree with them.
- Go types come from sqlc (`backend/sqlc.yaml` → `backend/database/*.query.sql.go`),
  generated from `database/migrations/`.

Schemas reserved but unused so far: `timekeeping`, `learning`, `compliance`, `payroll`,
`inventory`, `hiring`, `retention`, `communication`, `finance`, `procurement`, `assets`,
`crm`, `support`, `integrations`.

## Testing

| Command | What it runs |
|---|---|
| `make test-backend` | Go integration tests in `backend/integration` (77 files) against a live Postgres |
| `make test-frontend` | Playwright E2E against web |
| `make test-mobile` | Maestro flows against the Expo app |
| `make test` | all three |
| `make test-db-purge` | drops test organizations left behind |

Integration tests use the shared `testWorld` fixture (`integration/helper_test.go`) and run
with `t.Parallel()`; each test provisions its own organization so parallel runs cannot
collide. The suite — not unit tests — is the primary correctness gate, per Constitution
principle II.

## Known drift

**D8 — schema.sql leads migrations. Resolved.** `schema.sql` used to be hand-written
alongside the migrations, so the two could disagree: permission rows were added to it
before a migration existed for them, and live databases were missing seven `collab.*` /
`calendar.*` permissions until
`20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql` backfilled the
reference tables and every existing org's `iam.role_permission`. `schema.sql` is now
generated from the migrations, so the class of drift is gone by construction rather than by
discipline. The reconciling migration stays — it is what makes deployed databases correct.
`20260828000001_backfill_schema_comments.up.sql` closed the residue of the same split: 18
table and column comments that only ever existed in the hand-written file.

**No RLS backstop.** Worth restating as a standing risk rather than a defect: because
isolation is purely the `organization_id` predicate, a single query missing it leaks across
tenants with nothing to stop it. `integration/multi_tenancy_test.go` is the only guard.
