# Contributing to tech-office

Thanks for taking the time to contribute. This guide gets you from a fresh clone to a
running stack.

If anything here is wrong or out of date, that is a bug — please open an issue or fix
it in the same pull request as your change.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Go | 1.27.0 | Pinned in `go.work`, which is also what CI reads |
| Node.js | 20 or newer | |
| pnpm | 10.15.1 | Pinned via `packageManager` in `frontend/package.json`; `corepack enable` picks it up |
| Docker | any recent | Runs PostgreSQL and the other backend dependencies |

Mobile work needs more, but only if you are touching the apps:

| Tool | Notes |
| --- | --- |
| Xcode | iOS builds (macOS only) |
| Android Studio + JDK 17 | Android builds; `adb` must be on your `PATH` |

## Repository layout

| Path | What lives there |
| --- | --- |
| `backend/` | Go services, database migrations, `docker-compose.yml` for dev dependencies |
| `frontend/apps/web/` | Next.js web client |
| `frontend/apps/mobile/` | Expo / React Native app |
| `frontend/packages/` | Code shared between web and mobile |
| `deploy/` | Docker Swarm stacks for **production** — not used for local development |
| `docs/domain/` | How the system behaves today, one file per domain |
| `specs/` | Historical change proposals; records intent, not current behaviour |

Two things to know about the docs. `docs/domain/` is the living record of current
behaviour — read it first, and update it in the same change set when you alter an RPC
surface, a database constraint, a background job, or a cross-domain call. `specs/` is a
cumulative pile of proposals written *before* implementation, so some of it is stale;
where the two disagree, the code wins.

## Local development

Local development runs the **dependencies in Docker** and the **applications natively**.
That keeps rebuilds fast and debuggers attachable.

> The stacks in `deploy/` are the production Docker Swarm deployment. Do not use them
> for local development: they run prebuilt images, hide the backend behind Traefik on
> `*.localhost`, and occupy host ports that the dev setup needs.

### 1. Create the backend's environment file

```sh
cp backend/.env.example backend/.env
```

The defaults in it point at the services `make infra-up` starts. The four `R2_*` values
matter most: the backend refuses to start without them, and the example file points them
at the local MinIO rather than at Cloudflare R2.

### 2. Start the dependencies

```sh
make infra-up
```

This starts PostgreSQL (host port **15432**), clamav, gotenberg and MinIO (S3 API on
**9000**, console on **9001**, credentials `minioadmin` / `minioadmin`) from
`backend/docker-compose.yml`, and creates the `tech-office` bucket. `make infra-down`
stops them again.

### 3. Apply the database migrations

```sh
DATABASE_URL='postgres://postgres:tech_office_password@localhost:15432/tech_office_db?sslmode=disable' \
  backend/scripts/migrate.sh up
```

The runner is forward-only; `backend/scripts/migrate.sh status` prints where you are.

### 4. Generate the development signing key

```sh
cd backend && go run ./cmd tools keygen
```

This writes `backend/.dev-keys/jwt-private.pem`, which is git-ignored and which both the
server and the integration suite look for. Skip it and the server mints an ephemeral key
that no restart survives.

### 5. Start the backend

```sh
make voice-dev-backend
```

The backend listens on **http://localhost:18080**. Check it with:

```sh
curl http://localhost:18080/healthz
```

If you prefer live reload, [`air`](https://github.com/air-verse/air) works too — it
serves the same port.

### 6. Start the web client

```sh
cd frontend && pnpm install
pnpm --filter web dev
```

### 7. Verify everything is up

```sh
make check-servers
```

This checks PostgreSQL, the backend and the web client, and tells you the command to
start whichever one is missing.

## Running the mobile app

The mobile app talks to the backend on port 18080, and finding that port is the single
most common source of "the app just spins forever". Both platforms resolve it the same
way: `scripts/with-lan-ip.sh` looks up this Mac's LAN IPv4 and exports it as both the
Metro host and `EXPO_PUBLIC_API_URL`, so the device reaches Metro and the API on
`http://<lan-ip>:...`. Your Mac and the device have to be on the same network.

```sh
cd frontend/apps/mobile
pnpm start
```

One command for Android and iOS, device or emulator. It warns you if no backend answers
before starting Metro. To override the resolved host:

```sh
METRO_HOST=192.168.1.100 pnpm start
EXPO_PUBLIC_API_URL=http://10.0.0.5:18080 pnpm start
```

To build and install the native app first:

```sh
pnpm android      # or: pnpm ios
pnpm ios:device   # physical iPhone, with signing and launch
```

If `adb devices` shows your phone as `unauthorized`, accept the "Allow USB debugging?"
prompt on the device. If it shows nothing at all, enable Developer options → USB
debugging, and check you are using a data cable rather than a charge-only one.

### When the app cannot reach the backend

In development the app logs its resolved API base URL on startup:

```
[tech-office] API_BASE_URL = http://localhost:18080
```

Check that line first. If it is not what you expect, set it explicitly in
`frontend/apps/mobile/.env.local`:

```sh
EXPO_PUBLIC_API_URL=http://localhost:18080
```

That file is git-ignored, and `EXPO_PUBLIC_*` values are inlined into the bundle at
build time — **restart Metro after changing it**, or the old value stays baked in.

## Tests

```sh
make test-backend     # Go integration tests (needs PostgreSQL + backend)
make test-frontend    # Playwright end-to-end tests (needs backend + web)
make test             # everything
```

Both suites run against real services rather than mocks, so `make check-servers` should
pass before you start them.

To run just one test:

```sh
make test-backend-one T=TestTaskLifecycle   # Go test name
make test-frontend-one F=project-team       # Playwright spec file
```

Integration tests create real organisations. `TestMain` cleans up after each run, but if
you have a backlog from older runs, `make test-db-purge` clears it.

### Tenancy lint

```sh
make lint-tenancy
```

Every tenant table must be pinned to an `organization_id` parameter, and every unique
key must lead with it. This is enforced by a linter rather than by infrastructure, and
it reads the generated schema snapshot — so after writing a migration, run
`backend/scripts/regen-schema.sh` before this will reflect your change.

`backend/database/scripts/schema.sql` is generated from the forward-only migrations in
`backend/database/migrations/`. Never hand-edit it.

## What CI runs

`.github/workflows/checks.yml` runs on every pull request against `main` and on every
push to `main`:

| Job | What it does | Roughly |
| --- | --- | --- |
| Tracked files audit | `make check-tracked-files` — no large or binary files entering history | seconds |
| Backend static checks | `go build`, `go vet`, the non-integration Go tests, `make lint-tenancy` | 1–2 min |
| Mobile typecheck | `pnpm run typecheck:mobile` | 2–3 min |
| Backend integration suite | the whole local stack in Docker, then `go test ./integration/...` | 15–30 min |

The integration job reproduces the local setup above step for step — same compose file,
same migration runner, same server started from source — so a CI pass and a local pass
mean the same thing.

Two gates are deliberately *not* in CI yet. The web E2E suite drives a Next.js dev server
that compiles routes on demand, which is minutes of compilation before the first
assertion and still loses the occasional race with the compiler. `pnpm lint` fails with
184 pre-existing errors (drift D67). Both are tracked in `docs/domain/README.md`.

Images are published by `.github/workflows/publish-images.yml`, which runs only on a
`v*` tag (or a manual dispatch) — not on pull requests.

## Before opening a pull request

- Update `docs/domain/` if you changed how the system behaves, and delete anything no
  longer true.
- Add or update tests for the behaviour you changed.
- Run the suites relevant to your change.
- If you added a migration, regenerate the schema snapshot with
  `backend/scripts/regen-schema.sh` and make sure `make lint-tenancy` passes.
- Keep the change set coherent across backend, web and mobile. All clients ship
  together, so a breaking API change lands as one atomic change rather than as a
  compatibility shim.

## Troubleshooting

**`make infra-up` fails on a port that is already in use.** A production Swarm stack may
still be running from an earlier experiment. `docker stack rm techoffice` clears it.

**Gradle fails with `Network is unreachable` while every other tool has internet.**
Your network is likely IPv6-only. Gradle's HTTP client does not fall back to IPv6 the
way `curl` and the rest of the system do, so it fails while everything else works. Fix
the IPv4 connectivity rather than working around Gradle.

**The mobile app hangs on sign-in with no error.** It is pointing at the wrong host.
See [When the app cannot reach the backend](#when-the-app-cannot-reach-the-backend).
