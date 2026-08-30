# Platform

Cross-cutting mechanics every domain depends on: how a request is authenticated and
authorised, how tenant data stays separated, how background work runs, and how the whole
thing is tested.

**Status date: 2026-08-28.**

## Shape

A single Go binary (`backend/cmd`) serving Connect-RPC over HTTP/1.1 and h2c, backed by
one single-node PostgreSQL instance. The frontend is a pnpm workspace with a Next.js web
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
sqlc queries → PostgreSQL
```

The two-layer split (Connect layer / Logic layer) is Constitution principle III. Logic
constructors never take a pool; they take `database.DBTX` per call so the Connect layer
decides transaction scope.

## Multi-tenancy

Tenant isolation is **application-enforced, not RLS-enforced**.

- 84 of the 100 tables carry `organization_id` and a composite primary key
  `(organization_id, id)`. Every unique constraint on them leads with `organization_id`,
  and every join between two of them carries it in the join condition.
- The remaining 16 are global, with no `organization_id`: `public.permission`,
  `public.default_role`, `public.default_role_permission`, `public.organization`,
  `notification.active_listener`, the `flows.*` engine tables, and the account tables
  `iam.user`, `iam.sso_identity`, `iam.password_credential`, `iam.session`,
  `iam.password_reset_token`. A user is global; membership is per-org.
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

**`make lint-tenancy` is that backstop.** `backend/tools/tenancylint` parses `schema.sql`
and all 517 sqlc queries with the real PostgreSQL parser and fails the build unless every
tenant table in a statement is transitively connected, through `organization_id`
equalities, to an `organization_id = <parameter>` predicate. That one rule catches both a
missing filter and a join that forgot to carry `organization_id`. Tenant tables are
discovered from the schema — a table with an `organization_id` column is a tenant table —
so there is no list to keep in sync.

Eleven queries are legitimately cross-tenant (scheduler sweeps, the delivery retry worker,
the account-deletion path) and carry a `-- lint:cross-tenant <reason>` marker above their
`-- name:` line. They must run on `AdminPool`.

The database is a **single PostgreSQL node** and is not sharded — an earlier single-node
Citus deployment was removed in August 2026, since it imposed real constraints (no
triggers, no `now()` in `ON CONFLICT DO UPDATE`, no `ON DELETE SET NULL`) while delivering
nothing at one node. The discipline above outlives it: it is what keeps tenants isolated
today, and what would let the database be split later without a data migration. Two known
exceptions are recorded in `knownUniqueGaps` in the linter — `iam.invitation`'s primary key
and token uniqueness are global, because an invitation is resolved by token before the
invitee has any org context.

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
| `R2_PUBLIC_URL` | downloads are presigned URLs against the R2 S3 endpoint instead of the custom file domain (`transformar.file.devguards.com`); set, it also requires `R2_PUBLIC_URL_HMAC_SECRET` and a matching Cloudflare WAF token-auth rule — see [files.md](files.md#serving) |
| `LIVEKIT_*` | voice falls back to dev defaults (`ws://localhost:7880`, `devkey`) |
| `SES_*` | email sender logs instead of sending |

CORS is currently `cors.AllowAll()`.

Operational endpoints outside the RPC surface: `/healthz` (container health probes;
the binary's own `tech-office healthcheck` subcommand probes it from inside the
distroless image, which has no shell or curl),
`/api/internal/status` (detailed JSON), `/api/notifications/stream` (raw SSE for
`EventSource` clients), `/api/livekit/webhook`, and `/api/linking/{generate,resolve,preview}`.

## Deployment

One path: the Docker Swarm / Compose stacks in `deploy/`. The Kubernetes manifests are
gone. `deploy/stacks/*.yml` describes every service, port, volume, secret and health
check the system needs, so it also serves as the blueprint for anyone who wants to
translate it back to Kubernetes themselves.

**Shape.** 1–7 machines, placement by node label
(`techoffice.{edge,db,app,voice,processing,obs}`), Traefik terminating TLS in front of
web, backend and the LiveKit signalling socket, and one PostgreSQL instance. TLS is
either ACME (`TLS_MODE=acme`, HTTP-01) or operator-supplied (`TLS_MODE=file`); the file
mode takes up to two certificate pairs — `secrets/tls.*` as the default store and an
optional `secrets/tls2.*` selected by SNI — because `WEB_DOMAIN` and `API_DOMAIN` are
not always on one registrable domain. WebRTC media bypasses the proxy entirely, because ICE needs the client's real
address: `LIVEKIT_TRANSPORT=mux` publishes one muxed UDP port in host mode, and
`LIVEKIT_TRANSPORT=host` puts LiveKit on the voice node's own network stack so it can
own a real UDP range. Stack files are split by
profile — `voice`, `processing`, `backup`, `observability`, `registry` — and a profile
left out of `PROFILES` is removed from the fleet on the next deploy, which is how a site
with its own monitoring opts out of ours. `deploy/README.md` is the runbook.

**Observability** is OpenObserve: one container covering metric storage, PromQL,
dashboards and alerting, fed by a single OpenTelemetry collector that scrapes
node-exporter, cAdvisor, postgres_exporter and Traefik and pushes over OTLP. It replaced
a Prometheus + Grafana + Alertmanager trio. The alert set lives in
`deploy/config/openobserve/alerts.json` and is posted to OpenObserve's API by
`deploy/scripts/provision-openobserve.sh`; the only application metrics are the
`pgxpool` statistics each backend replica serves on `:18090/metrics`, so the rest of the
alert set is infrastructure-level plus Traefik's per-service 5xx rate.

`ConnectionPoolSaturated` watches the mean time an acquisition waits for a connection,
not the share of acquisitions that waited at all. The share is a ratio with no latency
floor: the `flow` pool has two usable connections and every registered workflow scans all
`FLOW_SHARD_COUNT` shards with one transaction each on every wake-up, so a few percent of
its acquisitions queue for microseconds on a completely idle fleet, which is not an
incident.

Its UI is published nowhere — not through Traefik, and not as a host port. Swarm's
host-mode publishing cannot bind to a single interface, so a published port would be on
every interface with one shared root credential in front of it. Reaching it means an SSH
tunnel whose remote end is a throwaway `socat` container joined to
`techoffice_internal`, which is declared `attachable` precisely so a plain `docker run`
can join the overlay and bind to loopback only. `deploy/README.md` carries the command.

**Alerting requires a notification destination.** OpenObserve rejects an alert that has
none, so `OBSERVE_ALERT_WEBHOOK_URL` is required whenever the `observability` profile is
enabled — there is no "alerts appear in the UI only" mode, and leaving it empty means no
alerting at all. `provision-openobserve.sh` fails fast rather than posting alerts that
cannot be created. The request body is provider-specific and lives in
`OBSERVE_ALERT_TEMPLATE_BODY`, defaulting to the Slack/Google Chat `{"text": …}` shape;
Discord wants `content`, and Telegram needs `chat_id` in the body with the bot token in
the URL. That value must be single-quoted in `deploy/.env`, which bash sources — unquoted
double quotes are stripped and the endpoint then silently rejects every alert. The
alerts, the template and the destination are all upserted by name, so an edited
definition, webhook or body takes effect on the next run. The alerts have to be looked up
and PUT over explicitly: OpenObserve's v2 API accepts a second alert with a name it
already holds, so a plain POST on every deploy accumulated copies that each paged
separately.

**Images** are published to `ghcr.io/nvcnvn/` by `.github/workflows/publish-images.yml`:
`tech-office-backend` and `tech-office-backend-migrate` for both architectures,
`tech-office-postgres` for both architectures too, now that no extension is built from
source. The web image is a special case: Next.js inlines `NEXT_PUBLIC_*` at build time, so an image is
welded to one deployment's hostnames. CI publishes exactly one —
`tech-office-web-transformar`, for the project's own hosted site — under a name that
cannot be mistaken for a generic image, and every other deployment builds its own with
`deploy/scripts/build-images.sh` or points `WEB_IMAGE` at its own published one.

Backups are pgBackRest to S3/R2: weekly full, daily differential, hourly incremental,
plus continuous WAL archiving via `archive_command`, compressed and encrypted
client-side. That combination is what makes point-in-time recovery possible;
`deploy/scripts/verify-restore.sh` restores the latest backup into a throwaway cluster
and asserts the schema, migration version and table contents came back, which is the
only evidence that any of it works. There is deliberately no PostgreSQL failover —
recovery is restore-from-object-storage.

The backup service starts as **root** and drops to `postgres` itself via `gosu`. Docker
creates a named volume owned by `root:root`, and both the pgBackRest lock directory and
the node-exporter textfile directory are shared volumes that `postgres` must write to;
without the fix every pgBackRest command fails with "unable to acquire lock", including
`stanza-create`, and the visible symptom is `archive_command` failing with "archive.info
… has a stanza-create been performed?" while WAL accumulates on disk. `backup-loop.sh`
therefore repairs both volumes' ownership on start. Anything that `docker exec`s into
that container — `backup-info.sh`, `backup-now.sh` — must pass `-u postgres`, since PID 1
there is root and pgBackRest refuses to run as root.

Two constraints bind the restore path. `--spool-path` must not be passed to `restore`:
pgBackRest carries it into the `restore_command` it writes into `postgresql.auto.conf`,
where `archive-get` rejects it as invalid without `archive-async`, failing recovery after
the restore itself has already succeeded. And the cluster that replays the WAL needs both
`pgbackrest.conf` mounted (its `restore_command` is `archive-get`, which cannot find the
repository otherwise) and `max_connections`/`max_worker_processes` at least as large as
the primary's, or recovery aborts with "insufficient parameter settings". Because
`pgbackrest.conf` is mode 600 and owned by the operator while these containers run as
uid 999, the scripts stage a 0644 copy inside a 0700 directory rather than bind-mounting
the original.

pgBackRest reports "error(s) detected during backup" on every backup of a database using
pgroonga. Its `pgrn*` files are not PostgreSQL 8 KB pages, so the page-checksum
validation is meaningless on them; the backup still exits 0 and restores correctly. The
restore drill, not the warning, is the signal to trust.

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

**schema.sql no longer leads the migrations.** `schema.sql` used to be hand-written
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
