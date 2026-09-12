# Implementation Plan: Production Safety Defaults

**Branch**: `060-production-safety-defaults` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/060-production-safety-defaults/spec.md`

## Summary

Three convenience defaults in the Go backend — an ephemeral JWT signing key, skipped SSO
audience validation, and `cors.AllowAll()` — are today enforced by nothing but a `slog.Warn`
line. This feature introduces a single runtime profile (`APP_ENV`, defaulting to
**production** when absent) and a startup safety report that is evaluated in
`startServer` *before* any pool is opened or any port is bound. In the production profile a
non-empty report aborts the process with a non-zero exit and a message naming every
violation at once; in the development profile the same report is logged as warnings and the
server starts unchanged.

Two of the three defaults also change behaviour, not just their enforcement:

- **Cross-origin.** `withCORS` keeps `cors.AllowAll()` only in development. In production it
  is built from `WEBAPP_URL` plus an optional `CORS_ALLOWED_ORIGINS` list, with every other
  `cors.Options` field left exactly as `AllowAll()` sets them, so preflight, streaming and
  origin-less requests behave as they do today.
- **SSO.** A provider with no configured audiences becomes **disabled** rather than
  audience-unchecked: `iam.JWKSVerifier` returns a new `ErrSSOProviderNotEnabled` for it in
  every profile, mapped to `CodeFailedPrecondition` with a `google.rpc.PreconditionFailure`
  detail so a client can tell "this provider is off here" from "your token was rejected".
  Its JWKS endpoint is no longer fetched at boot, which also unblocks an air-gapped
  deployment that does not use Google or Apple at all.

The signing-key default is untouched at runtime — an ephemeral key is still generated when
`JWT_PRIVATE_KEY_PATH` is unset — because in production the process now never reaches that
line.

## Technical Context

**Language/Version**: Go 1.25 (backend, `go.work`); TypeScript 5 / Next.js 15 (web); Expo SDK 54 (mobile)

**Primary Dependencies**: `connectrpc.com/connect`, `github.com/rs/cors` v1.11.1, `github.com/urfave/cli/v3`, `github.com/lestrrat-go/jwx/v3`, `github.com/joho/godotenv`, `google.golang.org/genproto/googleapis/rpc/errdetails`

**Storage**: PostgreSQL 17 — **no schema change in this feature**. No migration, no `schema.sql` regeneration.

**Testing**: `backend/integration/` (testWorld pattern, runs against the live dev server on `:18080`); `frontend/apps/web/e2e/` (Playwright); Go package tests in `backend/internal/config/` for the startup verdict itself (see *Testing Strategy* for the Principle II exclusion and its justification)

**Target Platform**: Linux server in Docker Swarm (`deploy/stacks/core.yml`), macOS/Linux for local development

**Project Type**: Web service (Go backend) + Next.js web + Expo mobile, single repository

**Performance Goals**: Startup-path only. The safety report is pure string and URL inspection over already-loaded configuration — sub-millisecond, before the first DB dial. Removing the boot-time JWKS fetch for disabled providers *saves* up to two synchronous 10-second-timeout HTTPS round trips per process start.

**Constraints**: The check must complete before `database.NewAdminPool` and before `net.Listen`, so a misconfigured production deployment never opens a connection or binds a socket. `/metrics` on `METRICS_PORT` and `/healthz` must be unaffected. Long-lived SSE (`/api/notifications/stream`) and Connect streaming must keep working for an allowed origin.

**Scale/Scope**: ~8 backend files, 3 configuration/tooling files, 3 documentation files. No proto change, no database change, no frontend source change beyond error copy.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Data Governance & Multi-Tenancy | ✅ N/A | No table, no query, no tenant-scoped data. Process-level configuration only. |
| II. Scenario-First Integration & E2E Testing | ⚠️ Partial, justified | Integration scenarios in `backend/integration/production_safety_test.go` cover everything observable through a *running* server (US2 in full, US1's success path, US3's permissiveness). The startup **verdict** itself cannot be observed that way — the suite talks to one already-running server it does not configure — so it is covered by `backend/internal/config/safety_test.go`. Justification and precedent in *Testing Strategy* below. Documented exclusion, as the principle requires. |
| III. Two-Layer Service Architecture & Proto-Level Authorization | ✅ Pass | No new RPC. `ErrSSOProviderNotEnabled` is raised in `internal/iam` (logic-adjacent verifier) and mapped to a Connect error in `ToConnectError`, which is exactly where every other IAM domain error is mapped. No pool reaches the logic layer. |
| IV. Cross-Domain Integration | ✅ Pass | No new cross-domain edge. `cmd/server.go` reads `internal/config` and passes values down, as it already does. |
| V. Observability, Simplicity & YAGNI | ✅ Pass | One new file (`internal/config/safety.go`), one new struct, two new env vars. No check registry, no plugin interface, no third profile. The report is a slice of values, so a fourth check is one appended function call. |
| VI. Versioning, Breaking Changes & Review | ✅ Pass (breaking, coordinated) | This is a deliberate breaking change for any deployment relying on the permissive defaults. Per the project's stance, it ships as one atomic change set across backend, deploy config and docs rather than behind a flag. Called out explicitly in `deploy/.env.example` and `docs/domain/platform.md`. |
| VII. Frontend API Wrapper Pattern & Type Safety | ✅ Pass | No new API surface. The new error is surfaced through the existing `iam` wrapper's error handling. |
| VIII. Cross-Stack Constant & Type Synchronization | ✅ Pass | The one value crossing the stack is the `PreconditionFailure.Type` string `SSO_PROVIDER_NOT_ENABLED`, declared in `backend/internal/iam/constants.go` next to `SSOProviderGoogle`/`SSOProviderApple` and mirrored in `frontend/packages/apis/src/iam.ts`. `APP_ENV` never leaves the server. |
| IX. UUID v7 & Nullable Cursor Params | ✅ N/A | No identifiers, no pagination. |
| X. Structured Error Details | ✅ Pass | `CodeFailedPrecondition` alone would not tell a client *which* provider is off or distinguish it from other precondition failures, so a `google.rpc.PreconditionFailure` detail carries `Type=SSO_PROVIDER_NOT_ENABLED`, `Subject=<provider>`. Round-trip verified by an integration scenario, as the principle requires. |
| XI. Distributed-First Architecture | ✅ Pass | Strengthens it. The durable-signing-key check exists precisely because two replicas signing with different ephemeral keys is a horizontal-scalability bug. The report is per-process, stateless, and identical on every replica. |
| XII. Living Documentation | ✅ Pass | `docs/domain/platform.md` and `docs/domain/auth-identity.md` updated in this change set, deleting the "logged as dev-only / must not ship that way" statements outright rather than annotating them. `backend/docs/SYSTEM-ARCHITECTURE.md` gains the startup-gate paragraph and `backend/docs/PRODUCTION-DAY1-CHECKLIST.md` its profile item. No drift-register row in `docs/domain/README.md` covers these three defaults — the snapshots described them accurately as warnings — so none is opened or closed. |
| XIII. Mobile Application Design & Testing | ✅ Pass | No mobile screen changes. `frontend/apps/mobile/src/lib/sso-availability.ts` already hides a provider whose client ID is absent, so the mobile client's notion of availability and the backend's now agree. No Maestro flow changes. |

**Gate result: PASS** — one documented, justified partial on Principle II.

### Post-Design Re-evaluation (after Phase 1)

Re-checked against the artifacts in this directory. No verdict changed. Two design choices
worth restating because they are what keeps the gates green:

1. **Origin derivation lives in `internal/config`, not in `cmd/server.go`.** `withCORS` stays
   a three-line function that takes an already-computed `[]string`. This is what makes the
   derivation testable at all (package `main` is awkward to test) and keeps Principle V's
   simplicity: no new package, no new interface.
2. **No new proto.** `google.rpc.PreconditionFailure` is an existing well-known type already
   used by `internal/collaboration/connect.go` and already extracted on the web side by
   `extractPreconditionViolations` in `frontend/packages/apis/src/errorDetails.ts`, so
   Principle X's "use existing `google.rpc.ErrorDetails` when possible" is satisfied with no
   `buf generate` cycle and no new frontend extractor.

## Project Structure

### Documentation (this feature)

```text
specs/060-production-safety-defaults/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions and rejected alternatives
├── data-model.md        # Phase 1 output — Profile, SafetyViolation, SafetyReport
├── quickstart.md        # Phase 1 output — how to run and prove the feature
├── contracts/
│   ├── configuration.md # Environment-variable contract (APP_ENV, CORS_ALLOWED_ORIGINS, …)
│   ├── startup-report.md# The exact shape of the startup failure and warning output
│   └── sso-provider-disabled.md # Connect error contract for a disabled provider
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── cmd/
│   └── server.go                       # MODIFIED: enforce report first; profile-aware withCORS;
│                                       #   provider-enablement log line; drop the three dev-only warns
├── internal/
│   ├── config/
│   │   ├── config.go                   # MODIFIED: Profile, AppEnvRaw, CORSAllowedOrigins,
│   │   │                               #   GoogleClientIDsRaw, AppleClientIDsRaw
│   │   ├── safety.go                   # NEW: ParseProfile, SafetyViolation, SafetyReport,
│   │   │                               #   AllowedOrigins, EnforceSafety
│   │   └── safety_test.go              # NEW: the startup verdict table
│   └── iam/
│       ├── jwks.go                     # MODIFIED: disabled provider => ErrSSOProviderNotEnabled;
│       │                               #   skip JWKS fetch for a disabled provider; EnabledProviders()
│       ├── errors.go                   # MODIFIED: ErrSSOProviderNotEnabled + PreconditionFailure mapping
│       └── constants.go                # MODIFIED: SSOProviderNotEnabledType constant
└── integration/
    └── production_safety_test.go       # NEW: scenarios reachable through the running server

deploy/
├── .env.example                        # MODIFIED: APP_ENV, CORS_ALLOWED_ORIGINS, SSO doc block
└── stacks/core.yml                     # MODIFIED: APP_ENV: production, CORS_ALLOWED_ORIGINS

backend/.env.example                    # MODIFIED: APP_ENV=development + explanation
Makefile                                # MODIFIED: voice-dev-backend exports APP_ENV=development

frontend/
├── packages/apis/src/iam.ts            # MODIFIED: surface SSO_PROVIDER_NOT_ENABLED
└── apps/web/e2e/                       # MODIFIED: sign-in spec asserts the disabled-provider copy

docs/domain/
├── platform.md                         # MODIFIED: profile + the three checks; delete "CORS is currently AllowAll"
└── auth-identity.md                    # MODIFIED: provider enablement; delete "audience validation is opt-in"

backend/docs/
├── SYSTEM-ARCHITECTURE.md              # MODIFIED: startup gate in the boot sequence
└── PRODUCTION-DAY1-CHECKLIST.md        # MODIFIED: "the backend logs it loudly" is no longer true
```

**Structure Decision**: Existing web-service layout, unchanged. The feature adds exactly one
new source file (`backend/internal/config/safety.go`) and two new test files. Everything else
is an edit to a file that already owns the concern: `cmd/server.go` already builds the CORS
handler and already logs the dev-only warnings this replaces; `internal/iam/jwks.go` already
holds the audience lists; `internal/iam/errors.go` already maps every IAM domain error to a
Connect error.

## Testing Strategy

### What is covered where, and why

**`backend/integration/production_safety_test.go`** — everything a running server can show.
The dev server the suite talks to (`make voice-dev-backend`) runs in the development profile
with no `GOOGLE_CLIENT_IDS` and no `APPLE_CLIENT_IDS`, which is exactly the configuration
User Story 2 is about. So the disabled-provider behaviour — the security-critical half of
this feature — is proven against the real server, end to end, including the error-detail
round trip.

**`backend/internal/config/safety_test.go`** — the startup verdict. This is the documented
Principle II exclusion.

*Justification.* The integration suite does not start the server; it connects to one that is
already running (`make check-backend` gates every test target on `/healthz` answering). A
scenario for "the process exits non-zero and binds no port when `APP_ENV=production` and
`JWT_PRIVATE_KEY_PATH` is unset" would have to fork a second server with a different
environment on a different port, own its lifecycle, and assert on its exit code — which is
not a behavioural scenario against the system under test, it is a process-control harness
that would make every developer's test run depend on spare ports and clean teardown. The
verdict is a pure function of environment variables, and testing it as one is both a truer
test and a smaller diff.

*Precedent.* The repository already tests configuration invariants this way:
`backend/database/pool_test.go` (`TestFleetWideConnectionCeiling`, which asserts a property
of `deploy/.env.example` against the pool ceilings), `backend/internal/voice/config_test.go`,
and `frontend/apps/mobile/src/lib/sso-availability.check.ts` — the last being the closest
analogue, a pure decision table for provider availability extracted specifically so it could
be checked without a device.

*Coverage handoff.* `safety_test.go` covers FR-001..FR-003, FR-007..FR-011, FR-013, FR-016..FR-020,
FR-026. `production_safety_test.go` covers FR-021..FR-025, FR-027, FR-028 and the User Story 1
and 3 success paths. FR-004..FR-006, FR-012, FR-014, FR-015, FR-029, FR-030 are covered by a
mix of both plus review of the configuration and documentation files — the per-FR mapping is
in the scenario file's header comment.

**`frontend/apps/web/e2e/`** — the only UI-visible change is the message shown when a
sign-in attempt hits a disabled provider. The existing sign-in spec gains one assertion. No
new spec file: the web sign-in page already hides both provider buttons when
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_APPLE_CLIENT_ID` are unset, so on a correctly
configured deployment a person cannot reach the disabled-provider error at all — it is a
misconfiguration guard, not a user flow.

### Behavioural contract — scenario stubs

These are the `t.Run` names to be written as stubs before any implementation, per Principle II.

```go
// backend/integration/production_safety_test.go
func TestProductionSafetyDefaults(t *testing.T) {

    // FR-023, FR-024, FR-025: US2 — an unconfigured provider is refused, not trusted
    t.Run("when a provider has no configured audiences", func(t *testing.T) {
        t.Run("exchanging a token for it is refused as not enabled", ...)
        t.Run("the refusal is distinguishable from a rejected token", ...)   // FR-024
        t.Run("the refusal carries the provider name in its error detail", ...) // FR-024, X
        t.Run("no account is created or linked by the refused attempt", ...)  // FR-023
        t.Run("linking that provider to an existing account is refused the same way", ...) // US2 AS4
    })

    // FR-028: US2 — password and PIN sign-in are unaffected
    t.Run("when identity providers are disabled", func(t *testing.T) {
        t.Run("workspace password sign-in still succeeds", ...)
        t.Run("worker PIN sign-in still succeeds", ...)
    })

    // FR-021, FR-022: US1 edge cases — the restricted policy does not break non-browser callers
    t.Run("when a request carries no origin header", func(t *testing.T) {
        t.Run("the health probe answers", ...)                    // FR-021
        t.Run("an RPC succeeds", ...)                              // FR-021
        t.Run("the notification stream stays open and delivers", ...) // FR-022
    })

    // FR-020: US3 — the development profile still permits every origin
    t.Run("when the development profile is active", func(t *testing.T) {
        t.Run("a preflight from an arbitrary origin is allowed", ...)
    })
}
```

```go
// backend/internal/config/safety_test.go
func TestRuntimeProfile(t *testing.T) {
    t.Run("an absent APP_ENV resolves to production", ...)                 // FR-002
    t.Run("development and production are the only accepted values", ...)  // FR-001
    t.Run("an unrecognised value is rejected and the error lists the accepted values", ...) // FR-003
    t.Run("the rejection covers casing and abbreviation typos", ...)       // Edge case
}

func TestStartupSafetyReport(t *testing.T) {
    t.Run("when the production profile is active", func(t *testing.T) {
        t.Run("an unset signing key path is a violation", ...)                    // FR-013
        t.Run("the signing key violation states sessions die on restart and differ across replicas", ...) // FR-014
        t.Run("a wildcard origin list is a violation", ...)                       // FR-017
        t.Run("a loopback workspace address is a violation", ...)                 // FR-018
        t.Run("an absent workspace address is a violation", ...)                  // FR-018
        t.Run("a provider whose audience list is whitespace-only is a violation", ...) // FR-026
        t.Run("a provider left entirely unset is not a violation", ...)           // FR-028
        t.Run("three simultaneous problems are reported together", ...)           // FR-010, SC-003
        t.Run("every violation names its setting, its exposure and a correct value", ...) // FR-011
        t.Run("no violation message contains a secret value", ...)                // FR-012
        t.Run("a fully safe configuration reports nothing", ...)                  // US1 AS5
    })
    t.Run("when the development profile is active", func(t *testing.T) {
        t.Run("the same violations are reported but are not fatal", ...)          // FR-009
        t.Run("each warning states it would prevent startup in production", ...)  // FR-009
    })
}

func TestAllowedOrigins(t *testing.T) {
    t.Run("the workspace address becomes the allowed origin", ...)         // FR-016
    t.Run("extra origins are appended to the workspace address", ...)      // FR-019
    t.Run("a whitespace-only origin list is treated as empty", ...)        // Edge case
    t.Run("the development profile allows every origin", ...)              // FR-020
}
```

## Complexity Tracking

> No Constitution Check violation requires justification beyond the Principle II exclusion,
> which is argued in *Testing Strategy* rather than here because it concerns test placement,
> not architectural complexity. No new project, no new abstraction, no new dependency.
