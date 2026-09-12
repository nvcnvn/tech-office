# Platform

Cross-cutting mechanics every domain depends on: how a request is authenticated and
authorised, how tenant data stays separated, how background work runs, and how the whole
thing is tested.

**Status date: 2026-09-12.**

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

Two surfaces hand the logic layer the **tenant pool** rather than a transaction, and both
are pure fan-out reads where a transaction bought nothing:

- `SearchService`. Its fan-out runs eight sources concurrently, and a `pgx.Tx` is not safe
  for concurrent use — eight goroutines sharing one would interleave protocol frames on a
  single connection. `*pgxpool.Pool` satisfies `database.DBTX` and gives each source its
  own connection.
- `linking.Service.PreviewBatch`. It calls one preview provider per resource type present
  in the request and there is no cross-provider consistency requirement; a failing provider
  is meant to cost only its own cards. It keeps `AdminPool` for exactly one thing — the
  pre-auth `tenantKey` → organization lookup on the global `public.organization` table.

The shape holds everywhere else.

## Multi-tenancy

Tenant isolation is **application-enforced, not RLS-enforced**.

- 87 of the 103 tables carry `organization_id` and a composite primary key
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
and all 557 sqlc queries with the real PostgreSQL parser and fails the build unless every
tenant table in a statement is transitively connected, through `organization_id`
equalities, to an `organization_id = <parameter>` predicate. That one rule catches both a
missing filter and a join that forgot to carry `organization_id`. Tenant tables are
discovered from the schema — a table with an `organization_id` column is a tenant table —
so there is no list to keep in sync.

Two schema rules run alongside it, over the same parse of `schema.sql`:

- **`unique-key`** — every primary key and unique constraint on a tenant table must
  include `organization_id`, because sharding cannot enforce a uniqueness that spans
  shards. Accepted exceptions live in `knownUniqueGaps` and print as `deferred` on every
  run rather than failing the build.
- **`set-null-tenant-column`** — a composite foreign key on a tenant table may not null the
  whole key on delete, and may not name `organization_id` among the columns it does null.
  A bare `ON DELETE SET NULL` nulls *every* column of the referencing key, so on a key
  leading with `organization_id` the action the database attempts is
  `SET organization_id = NULL` against a `NOT NULL` column and the delete fails outright —
  at runtime, on a row nobody is thinking about. The fix the finding states is PostgreSQL
  15's column list, `ON DELETE SET NULL (<column>)`. `SET DEFAULT` is covered for the same
  reason; `ON UPDATE` is not, because the referenced keys are UUID v7 primary keys and
  nothing updates them.

Both rules read the **generated** snapshot, so they only see a new constraint after
`backend/scripts/regen-schema.sh` has been run.

Fourteen queries are legitimately cross-tenant (scheduler sweeps, the delivery retry worker,
the account-deletion path) and carry a `-- lint:cross-tenant <reason>` marker above their
`-- name:` line — above it, not below, because the linter reads the comment block preceding
each `-- name:`. They must run on `AdminPool`.

The database is a **single PostgreSQL node** and is not sharded — an earlier single-node
Citus deployment was removed in August 2026, since it imposed real constraints (no
triggers, no `now()` in `ON CONFLICT DO UPDATE`, no `ON DELETE SET NULL`) while delivering
nothing at one node. `ON DELETE SET NULL` is therefore available again, and is used —
always in its column-list form, which `set-null-tenant-column` enforces. The discipline above outlives it: it is what keeps tenants isolated
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
`JWT_PRIVATE_KEY_PATH`). When that setting is unset an ephemeral key is generated, which
the production profile refuses to start with — see *Runtime profile and startup safety*
below. Permissions are resolved per request by `iam.PermissionLookup` against the
`AdminPool`, because role/permission rows must be readable regardless of tenant context.

The permission catalogue itself lives in `public.permission` (120 rows across 12 domains, `<domain>.<action>`
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
| `ritual_reconciliation_sweep` | every 5 min | one platform-wide pass writing late ritual instances into `overdue`, and one completion window later into the terminal `missed`, notifying on the transition it performs. Bounded at 500 instances per org per pass, oldest deadline first; idempotent, so its `MaxRetries: 2` retry is safe |
| `ritual_shift_resolution_sweep` | every 2 min | one platform-wide pass binding, rebinding and escalating the pool slots of ritual instances whose department pool uses the `on_shift` strategy. Bounded at 500 slots per org per pass, oldest scheduled date first. Every write is a compare-and-set on `resolution_state`, so overlapping passes assign once and notify once. Registered **after** `collaborationLogic.SetShiftCoverageReader(calendarLogic)` in `cmd/server.go`, so a first pass can never run against a nil reader |
| `CalendarReminderWorkflow` | every 1 min | polls due `calendar.event_reminder` rows and publishes reminders |
| `FileValidation` | on demand, concurrency 9 | MIME sniffing + ClamAV scan after upload |
| `FilePostProcessing` | on demand | PDF conversion, then text extraction into the content index |
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

## Runtime profile and startup safety

`APP_ENV` declares the posture of a process. It accepts exactly `development` and
`production`, case-sensitive with surrounding whitespace trimmed. **Unset or empty means
`production`** — the safe posture is the one you get by not thinking about it. Anything
else (`prod`, `Production`, `staging`) refuses to start with a message listing the two
accepted values; a staging fleet declares `production`, and there is no third profile.

`config.EnforceSafety` runs as the first statement of `startServer`, before
`database.NewAdminPool` and before `net.Listen`, so a process that fails it has opened no
connection and bound no port. Three checks are evaluated, and **none of them short-circuits**
— one restart shows the whole list:

| Check | Setting | Fails when |
|---|---|---|
| `durable-signing-key` | `JWT_PRIVATE_KEY_PATH` | unset, so sessions would be signed with a per-process key: everyone signed out on restart, and two replicas rejecting each other's tokens. A path that is set but unreadable still fails in `iam.NewInternalJWTSigner`, in every profile. |
| `cross-origin` | `WEBAPP_URL`, `CORS_ALLOWED_ORIGINS` | the origin list contains `*`, or `WEBAPP_URL` is empty, not an absolute URL with a scheme and host, or a loopback address (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`). Private LAN ranges and `.local`/`.internal` names pass — LAN-only and air-gapped fleets are supported deployments. |
| `sso-audience` | `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | the raw value holds something but parses to no usable entry (`" , "`). A provider left *entirely* unset is not a violation — it is disabled deliberately. |

In the **production** profile a non-empty report is fatal: one message naming every
violation with its setting, what it exposes and what a correct value looks like, and a
non-zero exit. No configured value is echoed, because the report goes to a log that may be
shipped off the box. In the **development** profile the same list is emitted as one
`slog.Warn` per violation reading "safety check would fail in the production profile", and
the server starts exactly as it did before.

The refusal itself is also emitted at `Info`, not `Error` — `main.go` calls
`slog.SetDefault`, which redirects the standard `log` package through the slog handler at
`LevelInfo`, and the message reaches the operator through `log.Fatal`. Look for the text,
not the level (drift row D84).

Two lines are logged at `Info` in every profile: `runtime profile resolved` and
`identity providers resolved`, the latter naming which sign-in methods are enabled and
which are disabled, so an operator can see it without grepping for an absence.

`make voice-dev-backend` sets `APP_ENV=development`; `deploy/stacks/core.yml` sets
`APP_ENV: production`.

**CORS.** `withCORS` is `cors.AllowAll()`'s option set with `AllowedOrigins` replaced by
`config.AllowedOrigins(profile)`. Development returns `["*"]`. Production returns the
origin of `WEBAPP_URL` — scheme, host and port, with the path and any trailing slash
discarded, because a browser's `Origin` header never carries them — followed by each entry
of `CORS_ALLOWED_ORIGINS`. Every other option is unchanged, including
`AllowedHeaders: ["*"]`, which is what keeps Connect's own preflight headers working. A
request with **no** `Origin` header passes straight through, so native mobile clients,
`/healthz` and server-to-server calls are unaffected; and CORS never touches a response
body, so SSE and Connect streaming behave identically. `/metrics` is on a separate
`http.Server` on `METRICS_PORT` that never passes through `withCORS` at all.

## Configuration

`internal/config` reads from the environment. The settings that change behaviour rather
than just endpoints:

| Variable | Effect when unset |
|---|---|
| `APP_ENV` | the **production** profile: a failing safety check refuses to start |
| `JWT_PRIVATE_KEY_PATH` | ephemeral signing key — all tokens die on restart, and the production profile will not start |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | the provider is **disabled**: its keys are never fetched, and every token exchange and identity link for it is refused |
| `CORS_ALLOWED_ORIGINS` | no origin beyond the one derived from `WEBAPP_URL` |
| `GOOGLE_APPLICATION_CREDENTIALS` | FCM client not built — **push notifications silently disabled** |
| `APNS_VOIP_*` | APNs VoIP client not built — iOS calls fall back to the alert ring instead of presenting as system calls. A *partially* set credential fails startup rather than degrading, because that is a deployment mistake and not an opt-out. See `backend/docs/APNS-VOIP-SETUP.md`. |
| `R2_*` | file storage unavailable |
| `R2_PUBLIC_URL` | downloads are presigned URLs against the R2 S3 endpoint instead of the custom file domain (`transformar.file.devguards.com`); set, it also requires `R2_PUBLIC_URL_HMAC_SECRET` and a matching Cloudflare WAF token-auth rule — see [files.md](files.md#serving) |
| `LIVEKIT_*` | voice falls back to dev defaults (`ws://localhost:7880`, `devkey`) |
| `SES_*` | email sender logs instead of sending |

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

Eleven application schemas exist, and every one of them holds objects: `calendar`, `chat`,
`collaboration`, `compliance`, `docs`, `files`, `flows`, `iam`, `notification`,
`organization`, `voice`. (`public` holds the migration runner's own bookkeeping.)

Thirteen further schemas — `assets`, `communication`, `crm`, `finance`, `hiring`,
`integrations`, `inventory`, `learning`, `payroll`, `procurement`, `retention`, `support`,
`timekeeping` — were created ahead of features that were never built, held nothing for the
life of the project, and were dropped by feature 062. `compliance` was previously listed
among them by mistake; it holds four objects and is in active use. `TestPlatformSchemaLayout`
in the integration suite now fails on any schema with no objects in it, so an empty one
cannot quietly reappear.

## Testing

| Command | What it runs |
|---|---|
| `make test-backend` | Go integration tests in `backend/integration` against a live Postgres |
| `make test-frontend` | three static assertion checks — the mobile palette's WCAG contrast sweep, the mobile theme resolution table and SSO availability — then Playwright E2E against web |
| `make test-frontend-one F=<spec>` | one Playwright spec |
| `make test-mobile` | the 27-flow standing Maestro suite against the Expo app |
| `make test-mobile-one F=<flow> [MAESTRO_DEVICE=<udid>]` | one Maestro flow; `MAESTRO_DEVICE` names the simulator or emulator, and with it the same command covers both platforms |
| `make test` | backend + frontend |
| `make test-db-purge` | drops test organizations left behind |
| `make lint-tenancy` | the multi-tenant schema discipline check; green |
| `make check-tracked-files` | binary and oversized-blob audit |

### Which of these CI enforces

One, and it is the cheapest. `.github/workflows/checks.yml` runs `pnpm run typecheck:mobile`
on every pull request against `main` and every push to it. It needs no database, backend,
device or browser, so it runs on a stock `ubuntu-latest` runner in a few minutes.

The workflow is `checks.yml` with a **named job** rather than `typecheck-mobile.yml`, so the
heavier gates can be added as further jobs without renaming it or re-pointing a branch
protection rule. There is deliberately no `paths` filter: a required check skipped by a path
filter reports as *pending*, not *passing*, and blocks the merge it was meant to wave through.

The other gates are not in CI, each for its own reason. `make test-backend` and
`make test-frontend` need a live Postgres and a backend; `make test-mobile` needs a device;
`pnpm lint` is itself red (D67), and a gate that fails on the default branch cannot be made
required without blocking every pull request.

Three things made the mobile check unreproducible outside the tree of a developer who had
already built once, and all three had to be fixed before it could be enforced at all:
`pnpm/action-setup` resolves `packageManager` from the **repository root**'s package.json,
which this repository does not have; the `typecheck:mobile` script called a bare `tsc` that
the root workspace does not declare; and every workspace package points `types` at a
gitignored `dst/`, so a clean checkout has no type declarations until `packages/` is built.
"It passes on my machine" was true and meant nothing.

### How the Maestro fixture is created

One command, run from `backend/` against a migrated database:

```
go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env
```

It creates or refreshes the `maestro` workspace the standing suite signs into and prints a
complete `.env` body to **stdout**; every progress and diagnostic line goes to **stderr**, so
the redirect above yields a usable file rather than one with log lines in it. It is
idempotent — a second run refreshes the same workspace rather than creating a second one, and
re-emits the ids that changed — and it refuses `--subdomain demo`, because that address
belongs to `seed-demo-org` and a store-review fixture must not share state with a suite that
mutates it.

The fixture carries what the 27 standing flows read: a primary account holding
`iam.inviteUser` with **both** a password and a permanent PIN (the two sign-in flows address
the same account by different credentials), a second account *without* that permission for
the worker feature tour, two directory colleagues that differ only in whether a phone number
is recorded, a department, a ritual project with one overdue assigned instance and one
unassigned instance due today, a chat channel, and a document, work item, event and file that
all match one nonsense search word.

`make test-mobile` refuses to launch a flow while any of the thirteen required variables is
missing **or empty**, naming the ones it cannot find and the command that produces them. The
empty case matters: the runner skips keys with an empty value, so a presence-only check passes
and the failure surfaces several flows later as a confusing assertion.

### What these gates can and cannot say today

`make test-frontend` starts and runs. It used to abort before executing a single spec,
because it gated on `check-frontend` — `curl -sf http://localhost:13000` — which probes a dev
server the suite does not use; Playwright starts and owns its own server on :3100. That guard
is gone (D71).

On a **warm** Next build cache the suite passes: a measured full run was 235 passed, 2 failed,
and both failures were real spec defects that have since been fixed and observed passing. On a
**cold** cache it is not yet reliable: `next dev` compiles each route on first visit, and a
navigation that arrives mid-compile gets a placeholder page or exceeds its timeout. That is
D54, and it is open with its cost measured — a production build and a route-warming setup were
both tried and both cost more than the gate is worth in their current form. `retries` is
deliberately not used: a suite that cannot be trusted to say no is not improved by retrying.

The E2E web server uses its own build directory (`NEXT_DIST_DIR=.next-e2e`) so that it cannot
share a compilation cache with a developer's `pnpm --filter web dev`. Two `next dev` processes
pointed at one `.next` evict each other's compiled routes continuously; with a stale dev
server running, a full-suite run went from nine minutes to hours.

`make test-backend` carries its own load-dependence. A handful of tests assert a latency
budget on a round trip rather than on a query and share one local Postgres with everything
else running at the same time, so they measure the machine's load as much as the code —
`TestEvidenceReviewQueuePerformance`'s 2 s first-page budget is the one that fails in
practice, and it passes in isolation.

`make check-tracked-files` is **not** green: `backend/tenancylint` is a committed 13.9 MB
executable that the audit rejects and that nothing needs, since `lint-tenancy` runs the tool
with `go run`. See D72.

Integration tests use the shared `testWorld` fixture (`integration/helper_test.go`) and run
with `t.Parallel()`; each test provisions its own organization so parallel runs cannot
collide. The suite — not unit tests — is the primary correctness gate, per Constitution
principle II.

## Known drift

**The development database is stored in an anonymous Docker volume.** The `postgres` service
in `backend/docker-compose.yml` declares no volume, so its data lives in an anonymous volume
created fresh with each container. `docker compose down`, or any removal of that container,
silently replaces a populated development database with an empty one. The old data is not
destroyed — `docker rm` without `-v` leaves the volume behind — but it survives only as an
unnamed dangling volume among dozens, which is a poor place to keep the only copy of a
workspace somebody spent an afternoon seeding. A named volume would fix it and would also
make `docker compose down -v` the single explicit way to discard it. See D86.


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

**`TestPDFConversion` can fail with `permission_denied` under full-suite load.** The DOCX
conversion scenario's polling call is refused with `permission_denied: insufficient
permissions` on some `make test-backend` runs; the test passes when run alone and passed on
an immediate repeat of the full suite. It is a different symptom from
`TestEvidenceReviewQueuePerformance`'s latency budget — a permission decision, not a clock —
so it is worth knowing whether something in the permission path is contended under parallel
load rather than assuming timing. Not investigated.

**No RLS backstop.** Worth restating as a standing risk rather than a defect: because
isolation is purely the `organization_id` predicate, a single query missing it leaks across
tenants with nothing to stop it. `integration/multi_tenancy_test.go` is the only guard.
