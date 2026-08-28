# Production Runtime Services

This repository ships one deployment: Docker Swarm / Compose stacks under
[`deploy/`](../../deploy/README.md). It manages the backend application, the runtime
services it depends on, **and** the database — unlike the previous Kubernetes path,
PostgreSQL is part of the stack rather than something you provision separately.

There is no Kubernetes manifest set any more. If you want to run this on Kubernetes,
translate `deploy/stacks/*.yml` yourself; they are a complete, working description of
every service, port, volume, secret and health check the system needs.

## Services

| Stack profile | Services | Notes |
| --- | --- | --- |
| core (always) | `traefik`, `postgres`, `backend`, `web` | Traefik terminates TLS; PostgreSQL runs as a single node |
| `voice` | `livekit` | signalling proxied, media direct to the node |
| `processing` | `clamav`, `gotenberg`, `whisper` | malware scanning, office→PDF, transcription |
| `backup` | `pgbackup` | pgBackRest base backups to S3/R2; WAL archiving is on the `postgres` service itself |
| `observability` | `openobserve`, `otel-collector`, `node-exporter`, `cadvisor`, `postgres-exporter` | optional — drop it if you have your own |
| `registry` | `registry` | optional private registry for an air-gapped fleet |

## Deployment order

`deploy/scripts/deploy.sh` does all of this; the order matters if you are doing it by
hand.

1. `deploy/scripts/bootstrap.sh` — swarm, node labels, generated keys, `pgbackrest.conf`.
2. `deploy/scripts/build-images.sh` — the web image must be built with this
   deployment's public URLs baked in, unless `WEB_IMAGE` points at one that already is
   (transformar.work pulls `ghcr.io/nvcnvn/tech-office-web-transformar`). The other
   three images come from `ghcr.io/nvcnvn/`.
3. Bring up PostgreSQL before anything connects to it (the deploy script does this by
   deploying the first pass with zero backend replicas).
4. `deploy/scripts/migrate.sh up` — runs the migration image as a one-shot container on
   the overlay network. It takes a Postgres advisory lock, so it is safe against a
   concurrent deploy.
5. Deploy the full stack. The backend rolls one task at a time, start-first.

## Background jobs

The backend bootstraps every recurring `flows` schedule at startup. `flows.ScheduleTx` upserts
by schedule ID, so all instances and every restart converge on exactly one row per job.

| Schedule ID | Workflow | Cadence | What it does |
| --- | --- | --- | --- |
| `ritual_generation_sweep` | `RitualGenerationWorkflow` | every 1 minute | Generates due ritual task instances for every organization that has at least one unarchived ritual definition |
| `calendar_reminder_poll` | `CalendarReminderWorkflow` | every 1 minute | Publishes notifications for `calendar.event_reminder` rows whose `fire_at` has passed, and marks them `sent` |

**`flows.Register` alone does not schedule a workflow.** Registration only makes a workflow
name resolvable by the worker; nothing runs until a matching `flows.ScheduleTx` writes its
`flows.schedules` row. Both calendar jobs were registered without that bootstrap and
consequently never ran in production — event reminders never fired. Any new recurring job
must add a `ScheduleTx` bootstrap in `backend/cmd/server.go` next to its `Register` call, and
a row in the table above.

To verify a deployment:

```sql
SELECT schedule_id, workflow_name, cron_expr, enabled FROM flows.schedules ORDER BY schedule_id;
```

Expect exactly one row per job listed above, `enabled = true`, unchanged across restarts and
across instances.

## Notes

- Public routing is Traefik with the **file provider**, configured in
  `deploy/config/traefik/`. Three hostnames: web, API, and the LiveKit signalling
  socket. Certificates come from Let's Encrypt (`TLS_MODE=acme`) or from files you
  supply (`TLS_MODE=file`).
- The API service is declared `h2c://` so Connect-RPC streaming and the SSE
  notification stream work through the proxy, with `flushInterval: 1ms` so nothing
  sits in a buffer.
- LiveKit takes its keys from `LIVEKIT_KEYS` (`<key>: <32+ character secret>`), the
  same value the backend derives its API key pair from unless explicit
  `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` are set. Webhooks post back to
  `/api/livekit/webhook` and are verified against that key.
- Media transport is chosen with `LIVEKIT_TRANSPORT`:
  - `mux` — one muxed UDP port (`7882` by default), LiveKit on the overlay network.
    One firewall rule; all media shares one socket.
  - `host` — a real UDP range (`5000-6000`) on the voice node's own network stack,
    which is what LiveKit prefers for scale. Requires `LIVEKIT_HOST` (that node's
    internal IP), because Traefik and the backend then reach it by address rather
    than service name, and its webhooks come back through the public API hostname.
- The embedded TURN server is **off** in both shapes: TURN/TLS wants port 443, which
  Traefik owns on the edge node. ICE-TCP on `7881` covers most restrictive networks.
  Clients that need a real TURN relay want a dedicated L4 TLS edge on a `turn.`
  hostname, which this deployment does not set up.
- If Cloudflare fronts the deployment, proxy the HTTPS hostnames and keep the media
  ports DNS-only unless you have Spectrum configured.
- Secrets are Docker secrets from files in `deploy/secrets/` (JWT signing key, FCM
  service account, APNs key, pgBackRest configuration, TLS certificate). Credentials
  that the backend reads from the environment come from `deploy/.env`.
