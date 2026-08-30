# On-premises deployment (Docker Swarm)

Deploys the whole of Tech Office — web, backend, PostgreSQL, LiveKit, file
processing, backups and (optionally) monitoring — onto **1 to 7 machines** you control,
with Docker Swarm doing the scheduling and Traefik terminating TLS.

Everything is driven by one file, `deploy/.env`, and five scripts.

```
                 ┌──────────── edge ────────────┐
   :443 ────────▶│ Traefik  (TLS, HTTP routing) │
                 └───┬──────────┬───────────┬───┘
                     │          │           │
              web:13000   backend:18080  livekit:7880   ← overlay network, encrypted
                                │            ▲
                                │            │ 7881/tcp, 7882/udp  ← media, direct
                                ▼            │                       from the client
                          postgres:5432   (no proxy: WebRTC needs the real client IP)
                                │
                                ▼
                  pgBackRest ──▶ S3 / Cloudflare R2  (base backups + WAL, encrypted)
```

## What this is not

Stated plainly so nobody discovers it during an incident:

- **No PostgreSQL high availability.** One instance, one disk. If the db node dies you
  restore from object storage (minutes, not seconds). This was a deliberate choice —
  a two-node Patroni cluster without a real quorum tier fails over wrongly more often
  than the hardware fails.
- **No LiveKit clustering.** One SFU. It carries hundreds of audio participants; past
  that it needs Redis and a different deployment.
- **The edge is a single node.** Traefik holds the ACME account and the certificates on
  a local volume. Two edge nodes need a shared certificate store.
- **Object storage is not backed up by this stack.** Uploaded files and recordings live
  in R2/S3; use that provider's versioning and lifecycle rules.

## Prerequisites

- Docker Engine 25+ on every machine, all on the same internal network.
- DNS for three names pointing at the **edge** node's public address:
  `WEB_DOMAIN`, `API_DOMAIN`, `MEDIA_DOMAIN`.
- An S3 or Cloudflare R2 bucket for backups, with its own credentials.
- A second bucket for user files (`R2_*`). The backend has no local-disk fallback and
  exits at startup without it, so this one is required too.
- Firewall openings:

  | Port | Proto | Node | Why |
  |---|---|---|---|
  | 80, 443 | tcp | edge | HTTP→HTTPS redirect, ACME challenge, all application traffic |
  | 7881 | tcp | voice | WebRTC fallback when UDP is blocked |
  | 7882 | udp | voice | WebRTC media — `LIVEKIT_TRANSPORT=mux` (one muxed port) |
  | 5000-6000 | udp | voice | WebRTC media — `LIVEKIT_TRANSPORT=host` instead of the above |
  | 2377, 7946, 4789 | tcp/udp | all | Swarm control plane and overlay networking — **internal network only** |

## Install

```sh
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env                       # domains, S3 + R2 buckets and keys, SSO client ids

deploy/scripts/bootstrap.sh               # swarm, node labels, keys, pgbackrest.conf
deploy/scripts/build-images.sh            # your web image, built with your URLs
deploy/scripts/deploy.sh                  # migrate, deploy, smoke test
```

### Images

Three of the four images are the same for every deployment and are published to the
GitHub Container Registry by `.github/workflows/publish-images.yml`:

```
ghcr.io/nvcnvn/tech-office-backend           linux/amd64, linux/arm64
ghcr.io/nvcnvn/tech-office-backend-migrate   linux/amd64, linux/arm64
ghcr.io/nvcnvn/tech-office-postgres          linux/amd64, linux/arm64
```

A fourth is published for the project's own hosted deployment:

```
ghcr.io/nvcnvn/tech-office-web-transformar   linux/amd64
```

**Do not pull that one for your own site.** It has `https://transformar.work` and its
SSO client IDs compiled into it, so it would serve a UI that talks to somebody else's
servers. The `-transformar` suffix is there so it cannot be picked up by accident.

`publish-images.yml` runs on `v*` tags, so a tag has to have been pushed before
`RELEASE_TAG=latest` resolves to anything, and **GitHub creates new packages private**.
Check before you rely on them:

```sh
docker manifest inspect ghcr.io/nvcnvn/tech-office-backend:latest
```

A `denied` there means the package is private or not published yet, and the deploy will
fail with `no such image`. Fix it once, either way:

- make each package Public under the account's Packages settings, after which nodes pull
  with `REGISTRY=ghcr.io/nvcnvn` and no credentials; or
- `docker login ghcr.io` with a `read:packages` token on every node; or
- build them yourself with `deploy/scripts/build-images.sh --all`, which needs no
  registry at all on a one-machine fleet.

**The web image is not published, and cannot be.** Next.js inlines `NEXT_PUBLIC_*` at
build time, so a web image is specific to one deployment's hostnames.
`build-images.sh` builds it locally from `deploy/.env` — which is also why you must
rebuild it if `WEB_DOMAIN` or `API_DOMAIN` ever changes. On a fleet of more than one
machine, set `WEB_REGISTRY` to somewhere you can push (your own ghcr namespace, or the
`registry` profile) so the other nodes can pull it.

Hence two tags in `deploy/.env`: `RELEASE_TAG` is the project images' tag (`latest`, or
pin a release), and `WEB_TAG` is your web build, which `build-images.sh` writes for you.
To build everything from source instead — an air-gapped fleet, or a fork — run
`build-images.sh --all`, which builds all four and moves both tags together.

If your web image is already published somewhere, set `WEB_IMAGE` to its full name and
the local build is skipped entirely. That is how transformar.work runs:

```sh
WEB_IMAGE=ghcr.io/nvcnvn/tech-office-web-transformar
WEB_TAG=v0.1.0
```

`bootstrap.sh` generates the database password, the LiveKit secret, the JWT signing key
and the backup encryption passphrase, and writes the generated ones back into
`deploy/.env`. **Copy that file somewhere safe.** Two of its values are unrecoverable:

- `jwt-private.pem` — replacing it signs every user out.
- `BACKUP_CIPHER_PASS` — without it every backup in the bucket is unreadable.

### Fleet layouts

Placement is by node label, never by hostname, so moving a role is a label change and a
redeploy. `bootstrap.sh` puts every role on the machine when there is only one.

| Machines | Labels |
|---|---|
| 1 | one node: `edge db app voice processing obs` |
| 3 | n1: `edge app` · n2: `db obs` · n3: `voice processing app` |
| 7 | n1: `edge` · n2: `db` · n3-n5: `app` · n6: `voice` · n7: `processing obs` |

```sh
deploy/scripts/label-node.sh node-2 db obs
```

Keep `db` and `voice` apart when you can: a backup that saturates the disk and an SFU
that needs steady CPU are bad neighbours.

## Sizing

The reference box is an **OVH Advance-1**: AMD EPYC 4245P (6 cores / 12 threads),
32 GB DDR5 ECC, 2x960 GB NVMe in soft RAID 1. Everything below is derived from that;
if yours is bigger, scale the memory column and `PG_*` together rather than one at a time.

### Memory

Limits are ceilings, not allocations, so they oversubscribe on paper — the point is that
no single service can take the machine down. Postgres is the only one whose ceiling is
also a reservation.

| Service | Limit | Why |
|---|---|---|
| OS + Docker + mdraid | ~2 G (unclaimed) | leave it alone |
| postgres | 10 G (reserve 6 G) | 4 G `shared_buffers` + backends + page cache |
| backend x2 (x3 mid-update) | 1500 M each | `GOMEMLIMIT=1200MiB` under it |
| web x2 | 768 M each | `--max-old-space-size=640` under it |
| traefik | 256 M | it proxies, it does not buffer |
| livekit | 2 G | 32 participants of audio, not video walls |
| clamav | 2560 M | the signature database is resident; under ~2 G clamd is OOM-killed |
| gotenberg | 1500 M | one Chromium per conversion |
| whisper | 3 G | **drop the model from `PROFILES` while `VOICE_TRANSCRIPTION_ENABLED=false`** |
| openobserve | 2 G | 30 days of one node's metrics is small |
| otel + node-exporter + cadvisor + pg-exporter | ~1.5 G total | monitoring must cost less than what it monitors |
| pgbackup | 1 G | pgBackRest streams, it does not buffer the cluster |

That is ~27 G of ceiling against 30 G of usable RAM, with the 3rd backend replica
during a rolling update already counted — and only if you drop whisper while
transcription is off. Leave whisper running and the mid-update total is ~30 G,
which is the whole machine.

Two backend replicas, not three: `start-first` keeps one serving throughout an
update, and a third steady replica costs 1.5 G and 2 CPUs on a box that has 6.

### CPU

Only Postgres runs uncapped. Everything else has a `cpus` limit so that a transcription,
a virus scan, a PDF render or a backup cannot starve it: whisper 3.0, livekit 3.0,
clamav 2.0, gotenberg 2.0, pgbackup 2.0, backend 2.0 each, openobserve 1.5, web 1.0,
traefik 1.0, exporters 0.25-0.5. Go 1.25 reads `GOMAXPROCS` from the cgroup quota, so the
backend limit sizes its scheduler for free.

### Connections

Sized from the pools outward, never the other way round. Each replica opens three
pools and they do different jobs, so they get different policies
(`backend/database/pool.go`):

| Pool | Max | Min | Idle | Lifetime | What uses it |
|---|---|---|---|---|---|
| tenant | 8 | 2 | 5 min | 30 min | every authenticated RPC: chat, docs, calendar, collaboration, voice, compliance |
| admin | 6 | 2 | 5 min | 30 min | permission lookup on every request, plus notification/push loops |
| flow | 3 | 1 | 30 min | 1 h | one flows worker per replica, polling on a ticker |

```
17 per replica
  x 3 replicas (BACKEND_REPLICAS + 1 during a start-first update)
  = 51
+ ~12 for postgres-exporter, pgBackRest, migrations, your psql
+ 5 superuser_reserved_connections
= PG_MAX_CONNECTIONS 80
```

`TestFleetWideConnectionCeiling` fails if those two ever drift apart.

pgx defaults `MaxConns` to `max(4, NumCPU)`, which on a 12-thread box is 12 for *every*
pool — 108 connections fleet-wide mid-update, for six cores. The sizing cannot live in
`DATABASE_URL` either, because the migration container passes that same string to `psql`
and libpq rejects pgx's `pool_*` parameters.

One connection each in the admin and flow pools is held permanently by a `LISTEN` loop
(notifications, and the flows worker) and never returns to the pool. That is why admin
keeps two warm connections to have one genuinely spare, and why flow's ceiling of three
is two usable.

### PostgreSQL 18

Worth knowing about what 18 changed under this deployment:

- **Asynchronous I/O.** `io_method=worker` (the default) with `io_workers=4` gets read-ahead
  on sequential scans, bitmap heap scans and vacuum. `io_uring` is *not* used: swarm ignores
  `security_opt`, so the `io_uring_*` syscalls stay blocked by the default seccomp profile,
  and unblocking them daemon-wide for an OLTP workload that mostly hits `shared_buffers` is
  a bad trade. Revisit if the workload turns analytical.
- `effective_io_concurrency` now defaults to 16 instead of 1; raised to 32 for NVMe.
- **B-tree skip scan** makes a multicolumn index usable when the leading column is not in
  the `WHERE` clause. With `org_id` leading almost every index here, some single-column
  indexes are now redundant — audit with `pg_stat_user_indexes` before adding more.
- `autovacuum_vacuum_max_threshold` caps the scale factor with an absolute row count, so
  large tables stop waiting for 20% of an ever-growing table to go dead.
- `dynamic_shared_memory_type=sysv` because swarm ignores `shm_size` and the default
  64 MB `/dev/shm` is not enough for parallel hash joins.

Verify after a deploy:

```sh
docker exec -it $(docker ps -qf name=techoffice_postgres) \
  psql -U office -d office -c "SELECT name, setting FROM pg_settings
    WHERE name IN ('io_method','shared_buffers','work_mem','max_connections','data_checksums');"
```

## Profiles

`PROFILES` selects what runs. Anything not listed is **removed** on the next deploy, so
this is also how you opt out of parts you already have.

| Profile | Services | Drop it when |
|---|---|---|
| *(core, always on)* | traefik, postgres, backend, web | — |
| `voice` | livekit | you run LiveKit Cloud or your own SFU |
| `processing` | clamav, gotenberg, whisper | you accept unscanned uploads (don't) or don't need PDF/transcripts |
| `backup` | pgbackrest scheduler | you back up PostgreSQL with your own tooling |
| `observability` | openobserve, otel-collector, node-exporter, cadvisor, postgres-exporter | **you already have monitoring** |
| `registry` | a private registry on the manager | your fleet has no reachable registry |

```sh
PROFILES="voice processing backup" deploy/scripts/deploy.sh    # bring your own monitoring
PROFILES="" deploy/scripts/deploy.sh                           # core only
```

Put the line in `deploy/.env` (`PROFILES="..."`) so every deploy uses the same set —
running `deploy.sh` with a different `PROFILES` than last time removes the difference.

## Upgrades

```sh
git pull
$EDITOR deploy/.env                       # RELEASE_TAG, if you pin instead of `latest`
deploy/scripts/build-images.sh            # rebuild web, writes the new WEB_TAG
deploy/scripts/deploy.sh
```

Migrations run against the live database before the new images roll, and the backend
rolls one task at a time with `start-first`, so there is no gap in service. A task that
fails its health check rolls the service back automatically.

Editing anything under `deploy/config/` also rolls the services that read it: config
names carry a hash of their contents, and Swarm treats a new name as a change.

## Backup and restore

This is the part that has to work, so it is the part with a drill.

**What is protected.** pgBackRest takes physical base backups (weekly full, daily
differential, hourly incremental by default) and PostgreSQL ships every WAL segment to
the same bucket as it is filled. Together they give point-in-time recovery to any moment
covered by retention (`BACKUP_RETENTION_FULL=4` full backups, so roughly a month).
Everything is compressed and **encrypted client-side** before it leaves the machine.

```sh
deploy/scripts/backup-info.sh            # what is in the repository, and how old
deploy/scripts/backup-now.sh full        # an extra backup, e.g. before an upgrade
```

**Prove it works.** Run this weekly, and always after changing anything about the backup
configuration. It restores the latest backup into a throwaway volume, starts a scratch
PostgreSQL on it, checks that the schema, the migration version and the real tables
came back, then deletes everything. It never touches production.

```sh
deploy/scripts/verify-restore.sh
```

**Restore.** Destructive, run on the db node, asks for confirmation:

```sh
deploy/scripts/restore.sh latest                       # newest consistent state
deploy/scripts/restore.sh "2026-08-28 14:30:00+00"     # just before someone dropped it
```

It stops the application, restores in place (`--delta`, so only changed files move),
restarts PostgreSQL to replay WAL, then brings the application back. Afterwards take a
fresh full backup — a restored cluster starts a new timeline — and remember that files
in object storage were **not** rolled back with the database.

**Losing the db node entirely:** label another machine `db`, run `deploy.sh` (it comes
up with an empty volume), then `restore.sh latest`.

## Monitoring

The `observability` profile runs **OpenObserve** — one container doing metric storage,
PromQL, dashboards and alerting, which is what Prometheus + Grafana + Alertmanager used
to do here. OpenObserve does not scrape, so a single OpenTelemetry collector does that
(node-exporter, cAdvisor, postgres_exporter, Traefik) and pushes over OTLP.

```
otel-collector ──scrape──▶ node-exporter (per node), cadvisor (per node),
       │                   postgres-exporter, traefik, backend :18090
       └──OTLP/http──▶ openobserve  :5080   storage + PromQL + dashboards + alerts
```

The UI is on `:5080` on the obs node, deliberately **not** published through Traefik.
Reach it over an SSH tunnel, or restrict that port to your admin subnet — Swarm's
host-mode publishing cannot bind to a single interface, so the firewall is the control.

```sh
ssh -L 5080:localhost:5080 obs-node        # http://localhost:5080
                                           # user: OBSERVE_ROOT_EMAIL, pass: OBSERVE_ROOT_PASSWORD
```

Give the exporter's database user the monitoring role once, so `pg_stat_*` is readable:

```sql
GRANT pg_monitor TO office;
```

**Alerts.** `deploy/scripts/provision-openobserve.sh` creates them through OpenObserve's
API; `deploy.sh` runs it on the first install, and it is safe to re-run (existing alerts
report as `exists`). The definitions live in `config/openobserve/alerts.json` — if the
API ever rejects one, paste that file into OpenObserve → Alerts → Import, which
validates interactively.

`BackupTooOld`, `BackupFailed` and `WALArchivingFailing` are the three worth reading
first: they fire while the problem is still fixable. WAL archiving failing means PITR is
already broken *and* the database disk is filling. Set `OBSERVE_ALERT_WEBHOOK_URL` to a
Slack incoming webhook to have alerts delivered rather than merely displayed.

Metrics are kept for `OBSERVE_RETENTION_DAYS` on the obs node's local disk. OpenObserve
can also write to S3 (`ZO_LOCAL_MODE_STORAGE=s3` plus the `ZO_S3_*` variables) — worth
doing if you want long retention, though not to the same bucket as the backups.

**Connection pools.** The backend serves `pgxpool` statistics on `:18090/metrics`, one
series per replica per pool, scraped through `tasks.backend` so every replica is covered
— plain `backend` is the load-balanced VIP and would report whichever task answered.
The port is separate from the request port because Traefik routes all of `API_DOMAIN` to
`:18080`; nothing on that mux is private.

`pgxpool_empty_acquire_count_total` is the number worth watching. It counts acquisitions
that had to wait for a connection to come back, which is the only honest answer to "are
the pools too small" — the ceiling itself tells you nothing.

```promql
sum by (pool) (rate(pgxpool_empty_acquire_count_total[5m]))
  / sum by (pool) (rate(pgxpool_acquire_count_total[5m]))
```

Flat at zero means the pools are not the constraint at any size. `ConnectionPoolSaturated`
fires when it holds above 5% for ten minutes. When it does, check whether Postgres is
actually busy first (`pg_stat_activity` by state): a pool that is empty because queries
are slow is not fixed by making the pool bigger — that just moves the queue into Postgres,
where each waiting connection costs a process.

Beyond the pools the application exposes no metrics, so the remaining alerts are
infrastructure-level. Application error rates come from Traefik's per-service 5xx.

## Operating notes

```sh
docker stack ps techoffice --no-trunc            # what is running, and what failed
docker service logs -f techoffice_backend
docker service scale techoffice_backend=5
deploy/scripts/smoke-test.sh                     # the three public endpoints
deploy/scripts/migrate.sh status
deploy/scripts/provision-openobserve.sh          # (re)create the alert set
```

**TLS.** `TLS_MODE=acme` (default) has Traefik obtain Let's Encrypt certificates over
HTTP-01, which needs port 80 reachable from the internet. For a LAN-only or air-gapped
deployment — or one behind a CDN that supplies its own origin certificate — set
`TLS_MODE=file` and put your certificate and key in `deploy/secrets/tls.crt` and
`deploy/secrets/tls.key`.

That certificate has to cover `WEB_DOMAIN`, `API_DOMAIN` and `MEDIA_DOMAIN`. When those
are not all on one registrable domain, a single certificate often cannot: put the second
one in `deploy/secrets/tls2.crt` and `tls2.key` and Traefik selects between them by SNI,
with `tls.crt` remaining the default for anything neither matches. Leave `tls2.*` as the
placeholder `bootstrap.sh` writes if one certificate is enough.

**LiveKit addressing.** Clients need an address they can actually send media to.
Internet-facing: leave `LIVEKIT_NODE_IP` empty and LiveKit discovers its public address
over STUN. LAN-only: set it to the voice node's LAN IP. Getting this wrong looks like
calls that connect and then have no audio.

**LiveKit transport.** `LIVEKIT_TRANSPORT=mux` (default) gives LiveKit one muxed UDP
port and keeps it on the overlay network: one firewall rule, and every call shares one
socket. `LIVEKIT_TRANSPORT=host` puts LiveKit on the voice node's own network stack so
it can own a real `5000-6000/udp` range, which is what LiveKit prefers once contention
on that single socket starts to show; it needs `LIVEKIT_HOST` set to that node's
internal IP, because Traefik and the backend then reach it by address rather than
service name. Swarm cannot publish a port range in host mode, which is why the range
requires the host-network variant rather than being a plain setting.

**Web image URLs.** Next.js bakes `NEXT_PUBLIC_*` at build time, so the web image is
specific to your domains. That is why `build-images.sh` reads `deploy/.env`, and why you
must rebuild the web image if you ever change `WEB_DOMAIN` or `API_DOMAIN`.

**A one-machine fleet without a registry** works: images built there are already local.
Two or more machines need `REGISTRY` set, or every node except the builder fails to pull.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `deploy.sh` stops after `docker stack deploy did not converge` | The task list it prints names the service; usually a published port already bound on that node, or an image no node can pull. Raise the cap with `DEPLOY_TIMEOUT=1800` if the fleet is merely slow |
| Backend crash-loops with `failed to create R2 client` | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT` are empty in `deploy/.env` |
| Tasks stuck in `Pending` | No node carries the label that service places on — `docker node inspect <node> --format '{{.Spec.Labels}}'` |
| `no such image` on some nodes | `REGISTRY` unset on a multi-node fleet |
| Certificates never issue | Port 80 not reachable from the internet, or DNS not pointing at the edge node |
| Calls connect but have no audio | `LIVEKIT_NODE_IP` / `use_external_ip` wrong, or 7882/udp closed |
| `WALArchivingFailing` | Bucket credentials or endpoint wrong in `deploy/secrets/pgbackrest.conf` — re-run `bootstrap.sh` after fixing `.env` |
| Backend restarts on a fresh install | Expected once if migrations had not finished; it settles |
| OpenObserve has no data | The collector cannot reach it, or the credentials changed without a redeploy — `docker service logs techoffice_otel-collector` |

## Kubernetes

There isn't one, and that is deliberate: this repository supports exactly one
deployment, and it is this one. The manifests that used to live in `backend/k8s/` were
incomplete and are gone.

If you want to run Tech Office on Kubernetes, `stacks/*.yml` is a working blueprint —
every service, image, port, volume, secret, health check, placement rule and resource
limit, in a form that maps onto Deployments, Services and ConfigMaps fairly
mechanically. The parts that need real thought when you translate it: PostgreSQL wants
an operator (CloudNativePG or StackGres) rather than the single instance here, LiveKit
needs `hostNetwork` for its media ports, and pgBackRest's `archive_command` has to stay
co-located with the database.
