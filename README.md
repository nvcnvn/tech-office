# tech-office

Despite the name, **tech-office** is built for everyone. It's a clean, easy-to-use collaboration platform designed for non-tech teams, while remaining versatile and powerful enough for software engineering teams.

## Why build this?

Small teams deserve first-class security and a beautiful UI/UX, but the current options are frustrating:
* **MS Teams** is bloated and slow.
* **Slack** is way too expensive.
* **Telegram & WhatsApp** are fine for casual chats, but you lose track of team work, search history gets messy, and files expire after a while. 

We wanted a secure, simple, and beautifully designed alternative that keeps teams aligned without the bloat or the hefty price tag.

## Architecture

TechOffice is a monorepo with a Go backend and a TypeScript frontend workspace:

```
tech-office/
├── backend/            Go server (Connect RPC over HTTP)
│   ├── cmd/            Entrypoint & service wiring
│   ├── internal/       Domain packages: iam, organization, chat, calendar,
│   │                   collaboration, docs, files, notification, voice, ...
│   ├── rpc/v1/         Protobuf definitions (buf) — the API contract
│   ├── database/       Authoritative schema.sql + sqlc queries
│   ├── integration/    Backend integration test suite
│   └── k8s/            Kustomize manifests + forward-only SQL migrations
├── frontend/           pnpm workspace
│   ├── apps/web/       Next.js web client (+ Playwright E2E in e2e/)
│   ├── apps/mobile/    Expo / React Native app (+ Maestro flows in .maestro/)
│   └── packages/       Shared: rpc (generated), apis (typed wrappers),
│                       theme-tokens, notifications, links, validations
├── docs/users/         End-user documentation
├── specs/              Feature specs (spec-driven development)
└── Makefile            Test runner & build/release entrypoints
```

The flow of a feature is **schema-first**: design the PostgreSQL schema → generate type-safe Go with `sqlc` → define the API in protobuf and generate Go + TypeScript clients with `buf` → frontend consumes the generated client only through typed wrappers in `packages/apis`.

Deeper dives live in [backend/docs/SYSTEM-ARCHITECTURE.md](backend/docs/SYSTEM-ARCHITECTURE.md) (plus notification and voice architecture docs in the same folder). The full documentation index — user guides and architecture docs — is at [docs/README.md](docs/README.md).

## Design Principles

The full, binding version is the project constitution at [.specify/memory/constitution.md](.specify/memory/constitution.md) — it governs every change. The short version:

* **Multi-tenant by construction.** Every business table carries `organization_id`, keys and indexes are Citus-sharding compatible, and tenant isolation is enforced at three layers: connection pool (`TenantPool` vs `AdminPool`), explicit query filters, and auth-context interceptors. API contracts never accept `organization_id` from users.
* **Scenario-first testing, no unit-test theater.** Every feature starts as reviewable integration-test scenarios (`backend/integration/`) and web E2E scenarios (`frontend/apps/web/e2e/`) derived from the spec's user stories. A feature is done only when the *entire* backend and E2E suites pass. Unit/snapshot/component tests are intentionally avoided.
* **Two-layer services with proto-level authorization.** Pure business logic (pool-agnostic, takes a `tx`) is separated from Connect RPC handlers (auth, transactions, error mapping). Every RPC declares its `allowed_roles` in the proto file — self-documenting, no role inheritance.
* **No cross-schema SQL.** Domains talk to each other through logic-layer interfaces sharing one transaction, never through cross-schema joins.
* **Distributed-first & stateless.** Backend instances hold no state in process memory; ephemeral state goes to PostgreSQL or a distributed cache, so everything scales horizontally.
* **Type safety across the stack.** Apps never import protobuf types directly — `packages/apis` wraps every RPC with clean TypeScript interfaces. Constants shared between DB, Go, and TypeScript are named constants validated by tests; string literals are treated as bugs.
* **Simplicity, observability, YAGNI.** Structured `log/slog` logging everywhere, no premature optimization, complexity must be justified.

## Technology & Tooling

| Layer | Stack |
|---|---|
| Backend | Go 1.25, [Connect RPC](https://connectrpc.com/), `pgx/v5`, `log/slog` |
| Database | PostgreSQL with Citus (sharding) — schema-first, `sqlc` codegen, forward-only `psql` migrations |
| API contract | Protobuf via `buf`, generating Go and TypeScript (`frontend/packages/rpc`) |
| Web | Next.js 15, React 19, MUI 7, Playwright (E2E) |
| Mobile | Expo (React Native 0.83), Maestro (UI flows), EAS builds |
| Realtime & media | LiveKit (voice), SSE (notifications), FCM (push) |
| Supporting services | ClamAV (file scanning), Gotenberg (document conversion), faster-whisper (transcription) |
| Tooling | pnpm workspaces, ESLint + Prettier, Docker Compose (local infra), Kustomize/k8s (prod), Makefile as task runner |

## Local Development & Testing

Prerequisites: Go 1.25+, Node 20+ with pnpm, Docker, and [air](https://github.com/air-verse/air) for backend hot reload (`go install github.com/air-verse/air@latest`).

```sh
# 0. One-time setup
cp backend/.env.example backend/.env
cd frontend && pnpm install && cd ..
cd backend && ./scripts/migrate.sh && cd ..   # idempotent, defaults to local dev DB

# 1. Backend with hot reload on :18080 (starts docker compose infra first)
make dev-backend             # ≈ cd backend && docker compose up -d && air

# 2. Web app on :13000
make dev-web                 # ≈ cd frontend && pnpm -F web dev

# 3. (Optional) Mobile app on a plugged-in iPhone
make dev-mobile              # Metro dev server (resolves your LAN IP)
make dev-mobile-device DEVICE=<name-or-udid>   # in another tab: build & install
# Simulator alternative: cd frontend/apps/mobile && pnpm ios / pnpm android
```

`make check-servers` verifies everything is reachable. Then run tests:

```sh
make test-backend                        # Go integration tests (needs postgres + backend)
make test-backend-one T=TestTaskLifecycle
make test-frontend                       # Playwright E2E (needs backend + web)
make test-frontend-one F=project-team
make test-mobile                         # Maestro flows (needs simulator + backend)
make test-mobile-one F=auth/signin
make test                                # backend + frontend suites
```

See the [Makefile](Makefile) header for the full target list, including production image builds.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, testing requirements, and ground rules. The short version: read the [constitution](.specify/memory/constitution.md), start non-trivial features with a spec and test scenarios, and make sure the full test suites pass — tests are the definition of done.

Not sure where to start? Issues and the [Roadmap](#roadmap) below are good entry points — or open a discussion first for bigger ideas.

## Hosting & Support

* **100% Open Source:** The source code is completely free to self-host.
* **Affordable Hosting:** If you don't want the hassle of self-hosting, we offer a cheap, flat-rate hosted version to cover hardware (CPU, RAM, bandwidth, and storage) with a tiny profit margin to keep the project running. Check it out at [transformar.work](https://transformar.work/).
* **Sponsor:** If you like this project and want to support it, feel free to drop a small sponsor on [GitHub Sponsors](https://github.com/sponsors/nvcnvn).

## Roadmap

* **Documentation:** The `specs/` directory is currently a bit of a draft as we test our Spec-kit AI workflow and make manual fixes. Better, cleaner documentation is on the way.
* **Mobile Apps:** Publishing the mobile app to app stores for demo/testing.
* **CI/CD:** Automating build pipelines for the backend, web client, and Android app.
* **Testing:** Writing and expanding backend integration and frontend E2E test coverage.
* **Paid plans:** Actually let see if there is real demands but I do hope for some pocket change for keep the sever running.
* **AI Integrations:** BYOK with features like auto transcript, auto chat channel summary... and yes, MCP

## License

TechOffice is open source under the [Apache License 2.0](LICENSE).
