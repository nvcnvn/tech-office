# On-premises deployment (Docker Swarm)

Deploys the whole of Tech Office — web, backend, PostgreSQL/Citus, LiveKit, file
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
$EDITOR deploy/.env                       # domains, S3 bucket + keys, SSO client ids

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
ghcr.io/nvcnvn/tech-office-postgres          linux/amd64  (it compiles Citus from source)
```

A fourth is published for the project's own hosted deployment:

```
ghcr.io/nvcnvn/tech-office-web-transformar   linux/amd64
```

**Do not pull that one for your own site.** It has `https://transformar.work` and its
SSO client IDs compiled into it, so it would serve a UI that talks to somebody else's
servers. The `-transformar` suffix is there so it cannot be picked up by accident.

They are public, so nodes pull them without credentials — `REGISTRY=ghcr.io/nvcnvn` and
nothing else. (If you fork this, remember GitHub creates new packages private: flip each
to Public once, under the account's Packages settings, or `docker login ghcr.io` with a
`read:packages` token on every node.)

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
PostgreSQL on it, checks that the schema, the Citus shard metadata and the real tables
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
       │                   postgres-exporter, traefik
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

The application itself exposes no metrics yet, so these alerts are infrastructure-level.
Application error rates come from Traefik's per-service 5xx.

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
deployment set `TLS_MODE=file` and put your certificate and key in
`deploy/secrets/tls.crt` and `deploy/secrets/tls.key`.

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
