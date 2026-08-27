# Platform

Cross-cutting mechanics every domain depends on: how a request is authenticated and
authorised, how tenant data stays separated, how background work runs, and how the whole
thing is tested.

**Status date: 2026-08-27.**

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
rescue push worker (1 s), and the presence pong batcher.

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
| `R2_*` | file storage unavailable |
| `LIVEKIT_*` | voice falls back to dev defaults (`ws://localhost:7880`, `devkey`) |
| `SES_*` | email sender logs instead of sending |

CORS is currently `cors.AllowAll()`.

Operational endpoints outside the RPC surface: `/healthz` (k8s probes),
`/api/internal/status` (detailed JSON), `/api/notifications/stream` (raw SSE for
`EventSource` clients), `/api/livekit/webhook`, and `/api/linking/{generate,resolve,preview}`.

## Schema and migrations

- `backend/database/scripts/schema.sql` (~4.4k lines) is the canonical schema, written to
  apply cleanly top-to-bottom. Consult it first when debugging.
- `backend/k8s/base/database/migrations/` holds the ordered migrations that are actually
  deployed.
- Go types come from sqlc (`backend/sqlc.yaml` → `backend/database/*.query.sql.go`).

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

**D8 — schema.sql leads migrations.** Permission rows were added to `schema.sql` before a
migration existed for them, so live databases were missing seven `collab.*` / `calendar.*`
permissions until `20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql`
backfilled both the reference tables and every existing org's `iam.role_permission`. The
lesson holds generally: `schema.sql` describes intended state, migrations describe deployed
state, and they can disagree. Diff them before trusting either for a live-data question.

**No RLS backstop.** Worth restating as a standing risk rather than a defect: because
isolation is purely the `organization_id` predicate, a single query missing it leaks across
tenants with nothing to stop it. `integration/multi_tenancy_test.go` is the only guard.
