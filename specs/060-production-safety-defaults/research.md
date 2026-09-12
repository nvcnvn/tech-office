# Phase 0 Research: Production Safety Defaults

Every `[NEEDS CLARIFICATION]` raised while filling the Technical Context is resolved here.
This session ran unattended, so each one is closed with the choice a senior engineer
following the repository's existing conventions would make, recorded as an `[ASSUMPTION: …]`
so it can be reviewed.

## Current state, as read from the code

| Concern | Where it lives today | Behaviour today |
|---|---|---|
| Signing key | `backend/cmd/server.go:103-115` | `JWT_PRIVATE_KEY_PATH` set → `iam.NewInternalJWTSigner`, which fails startup if the file is unreadable. Unset → `slog.Warn("… using ephemeral key (dev only)")` and `iam.NewEphemeralSigner()`. |
| SSO audiences | `backend/cmd/server.go:126-137`, `backend/internal/iam/jwks.go:104-155` | Two `slog.Warn` lines when the lists are empty. `VerifyGoogleToken`/`VerifyAppleToken` guard the audience comparison with `if len(v.googleAudiences) > 0`, so an empty list means *no* audience check. Both JWKS endpoints are fetched synchronously at boot and a fetch failure aborts startup. |
| CORS | `backend/cmd/server.go:766-768` | `withCORS` is `cors.AllowAll()`, unconditionally, with no configuration at all. |
| Profile | — | Does not exist. |

`internal/config` is a `sync.Once` singleton (`config.Get()`) with no error return, loading
`.env` by walking up from the working directory. `getEnvStringSlice` already trims and drops
blank entries, so `GOOGLE_CLIENT_IDS=" , "` and an unset variable are currently
indistinguishable downstream — which matters for FR-026.

## Decisions

### D1 — The profile setting is `APP_ENV`, with values `development` and `production`

**Decision**: A single environment variable `APP_ENV`. Accepted values are exactly
`development` and `production`, compared case-sensitively against the whole trimmed value.
Absent or empty resolves to `production`. Anything else fails startup with a message listing
the two accepted values.

**Rationale**: `APP_ENV` is the conventional twelve-factor name and reads unambiguously in
`deploy/stacks/core.yml` next to `SERVER_PORT` and `GOMEMLIMIT`. The spec's own assumptions
already settled that the profile is explicit rather than inferred and that there are exactly
two values; this decision only fixes the spelling.

Case-sensitivity is deliberate rather than lenient. The spec's edge case requires that
`Production` not be silently accepted, and the cheapest way to honour that is to not
lowercase the input: a typo produces the error listing the accepted values, which is exactly
the outcome FR-003 asks for. Trimming surrounding whitespace is still done, because a value
arriving from a `.env` file or a YAML scalar can pick up a trailing space that carries no
intent.

**Alternatives considered**:
- `ENVIRONMENT`, `GO_ENV`, `NODE_ENV`-style naming — no advantage, and `GO_ENV` invites
  confusion with the Go toolchain's own `GOENV`.
- Inferring the profile from `WEBAPP_URL` being non-loopback, or from `TLS_MODE` — rejected
  in the spec, and rightly: it makes the security posture a side effect of an unrelated
  value.
- Case-insensitive matching with an alias table (`prod`, `dev`, `staging`) — directly
  contradicts the spec's edge case and turns a typo into a silent decision.

### D2 — Profile resolution returns an error; the config singleton stays error-free

**Decision**: `config.Config` stores the raw string as `AppEnvRaw`. A free function
`config.ParseProfile(raw string) (Profile, error)` does the resolution, and
`cfg.EnforceSafety(ctx)` calls it first: if it errors, `startServer` returns that error
immediately, before any check is evaluated.

**Rationale**: `config.Get()` is a `sync.Once` singleton with no error channel, used from
`cmd/tools.go`, `cmd/healthcheck.go` and `cmd/seed_demo.go` as well as the server. Adding an
error return would ripple through all of them for one variable. Keeping the raw string in
`Config` and validating at the one call site that cares is smaller and leaves the other
subcommands unaffected — which is correct, because `tech-office healthcheck` running inside
a distroless container must not refuse to probe `/healthz` over a profile typo.

**Alternatives considered**:
- `log.Fatal` inside `config.load()` — untestable, and it would kill the healthcheck
  subcommand too.
- Panicking on an invalid value — the same problem, with a worse exit code and a stack trace
  instead of the message FR-003 requires.

### D3 — The safety report is a slice of value structs, evaluated by one function

**Decision**:

```go
type SafetyViolation struct {
    Check    string // stable identifier, e.g. "durable-signing-key"
    Setting  string // the environment variable to change, e.g. "JWT_PRIVATE_KEY_PATH"
    Exposure string // what the current state exposes
    Fix      string // what a correct value looks like
}

func (c *Config) SafetyViolations(p Profile) []SafetyViolation
func (c *Config) EnforceSafety(ctx context.Context) error
```

`SafetyViolations` appends in a fixed order (signing key, cross-origin, SSO audiences) and
never returns early. `EnforceSafety` resolves the profile, logs it once at `Info`, collects
the violations, and then either returns a single error whose message contains all of them
(production) or emits one `slog.Warn` per violation (development).

**Rationale**: FR-010 is the whole reason the report exists as a collection rather than a
sequence of `if … return err`. A slice of plain structs makes "report everything" the
default behaviour instead of a discipline someone has to remember. A fourth check is one
more `if` and one more `append`, with no registry, no interface and no init-time
registration — Principle V.

**Alternatives considered**:
- A `Check` interface with `Name() string` and `Evaluate(*Config) error`, plus a package-level
  registry — the classic over-build. Three checks, in one file, that will never be
  implemented outside this package. Rejected.
- `error` values joined with `errors.Join` — loses the structure FR-011 needs (setting,
  exposure, fix as separate fields) and makes the message hard to format consistently.

### D4 — The gate runs as the first statement of `startServer`

**Decision**: `EnforceSafety` is called immediately after `cfg := config.Get()`, before
`database.NewAdminPool`, before `iam.NewJWKSVerifier`, and long before `net.Listen`.

**Rationale**: FR-007 and SC-001 require that no port is bound. Running first also means a
misconfigured deployment does not open a Postgres connection or make an outbound HTTPS
request to Google before failing, which is both faster and quieter in the logs. `main.go`
already turns a non-nil error from a `cli.Command` action into `log.Fatal`, which exits 1 —
so non-zero exit needs no new code.

**Alternatives considered**:
- Evaluating inside `config.load()` — see D2.
- Evaluating after the pools are up so the message can mention database state — no check
  needs database state, and it would violate "before binding any listening port" in spirit.

### D5 — Production origins are derived from `WEBAPP_URL`, plus `CORS_ALLOWED_ORIGINS`

**Decision**: `config.AllowedOrigins(p Profile) []string` returns `["*"]` in development. In
production it returns the origin of `WEBAPP_URL` (scheme + host + port, path and everything
after it discarded) followed by each non-blank entry of `CORS_ALLOWED_ORIGINS`, a
comma-separated list parsed with the existing `getEnvStringSlice`.

**Rationale**: the spec settled the derivation; this fixes the variable name and the
normalisation. Normalising `https://office.example.com/` to `https://office.example.com` is
necessary because a browser's `Origin` header never has a trailing slash, and `rs/cors`
compares the header literally — an operator who pastes a URL with a trailing slash into
`WEBAPP_URL` would otherwise get a check that passes and a browser that is still blocked.
`WEBAPP_URL` is already `https://${WEB_DOMAIN}` in `deploy/stacks/core.yml`, so a correctly
configured deployment needs no new setting at all.

**Alternatives considered**:
- A required `CORS_ALLOWED_ORIGINS` with no derivation — a second place to write the same
  hostname, and every existing deployment would need a new value to keep working.
- Deriving from `API_DOMAIN` — wrong: the allowed origin is where the *browser page* came
  from, not where the API lives.

### D6 — The production CORS handler changes only `AllowedOrigins`

**Decision**:

```go
func withCORS(h http.Handler, origins []string) http.Handler {
    return cors.New(cors.Options{
        AllowedOrigins:   origins,
        AllowedMethods:   []string{http.MethodHead, http.MethodGet, http.MethodPost,
                                  http.MethodPut, http.MethodPatch, http.MethodDelete},
        AllowedHeaders:   []string{"*"},
        AllowCredentials: false,
    }).Handler(h)
}
```

which is `cors.AllowAll()`'s option set verbatim (verified against
`github.com/rs/cors@v1.11.1/cors.go:254`) with `AllowedOrigins` replaced. In development
`origins` is `["*"]`, making the development path byte-for-byte today's behaviour.

**Rationale**: the narrowest possible change to a middleware that sits in front of every
request. Keeping `AllowedHeaders: ["*"]` preserves Connect's `Connect-Protocol-Version`,
`Connect-Timeout-Ms` and `Content-Type` preflights without enumerating them, which is the
class of omission that breaks streaming in production and not in a test. `AllowCredentials`
stays false because the clients send a bearer token in a header, not a cookie.

On the two edge cases the spec calls out: `rs/cors` passes a request with **no** `Origin`
header straight through to the wrapped handler without adding or requiring anything, so
native mobile clients, `/healthz`, and server-to-server calls are unaffected (FR-021); and
CORS is a preflight-and-response-header protocol that does not touch the response body, so
an allowed origin's SSE stream and Connect streaming responses behave identically to today
(FR-022). `/metrics` is on a **separate** `http.Server` on `METRICS_PORT` that never goes
through `withCORS` at all, so it cannot be affected either way.

**Alternatives considered**:
- Adopting `connectrpc.com/cors` for its curated header list — a new dependency for a
  handful of strings, and it would *change* today's development behaviour as a side effect.
  Rejected per the ladder: the already-installed dependency does the job.
- Adding `ExposedHeaders` for `Grpc-Status` and friends — not needed by the Connect and
  Connect-Streaming protocols this repository's clients use, and adding it would be an
  unrequested behaviour change smuggled in under a security fix.

### D7 — The workspace-address check rejects loopback only, not all private addresses

**Decision**: the cross-origin check fails in production when `WEBAPP_URL` is empty, does not
parse as an absolute URL with a scheme and host, or whose host is `localhost`, any address in
`127.0.0.0/8`, `::1`, `0.0.0.0`, or `[::]`. Hosts in RFC 1918 private ranges (`10.x`,
`192.168.x`, `172.16–31.x`) and `.local`/`.internal` names **pass**.

**Rationale**: `deploy/README.md` and `deploy/.env.example` both document LAN-only and
air-gapped fleets as supported deployments (`TLS_MODE=file` with an internal CA,
`LIVEKIT_NODE_IP` set to a LAN IP, a local `registry` profile). Rejecting private addresses
would refuse to start a deployment the project explicitly supports, in the name of a rule
that would buy nothing — a private-range origin is a real browser origin for the people on
that network. Loopback is different in kind: no browser on any *other* machine can ever
present `http://localhost:13000` as its origin, so a production deployment holding the
development default allows literally no client, which is the failure FR-018 exists to catch.

`[ASSUMPTION: "loopback or local development address" in FR-018 is read as loopback plus
malformed/absent, not as all non-public addresses, because the repository documents LAN-only
and air-gapped deployments as supported and a private-range origin is a working origin for
them. If a future deployment wants the stricter rule it is one predicate in the same
function.]`

**Alternatives considered**:
- Requiring `https://` in production — tempting and nearly right, but `TLS_MODE=file` fleets
  terminating TLS at a separate appliance, and the air-gapped LAN case, would break. Out of
  scope for a spec that named three checks.

### D8 — A provider with no audiences is disabled inside `JWKSVerifier`

**Decision**: `iam.NewJWKSVerifier` skips the JWKS fetch for a provider whose audience slice
is empty, and stores the pool as nil. `VerifyGoogleToken`/`VerifyAppleToken` return
`ErrSSOProviderNotEnabled` before parsing anything when their audience slice is empty, so the
`if len(audiences) > 0` guard around the comparison disappears — with an audience list
present the check is unconditional (FR-025). A new method `EnabledProviders() []string`
supports the startup log line (FR-027).

**Rationale**: putting the decision in the verifier means every current and future call site
gets it for free. There are three today (`ExchangeToken`, `LinkSSOIdentity`, and the SSO path
of `AcceptInvitationWithToken`, all in `internal/iam/connect_auth.go`) and all three already
route their error through `ToConnectError`, so the refusal reaches the client correctly with
no change at any call site. Guarding at the call sites instead would be three edits today and
a missed one later — the root-cause fix is the single guard all callers route through.

Skipping the fetch is not merely an optimisation: `NewJWKSVerifier` currently *aborts startup*
when either JWKS endpoint is unreachable, so today an air-gapped deployment that uses neither
Google nor Apple cannot boot at all. Skipping disabled providers fixes that as a direct
consequence of the same change.

**Alternatives considered**:
- Returning a nil verifier and nil-checking at the call sites — spreads the decision and
  makes a nil-pointer panic the failure mode for a missed call site.
- Failing startup when a provider is unconfigured — rejected in the spec: it would block a
  legitimate password-and-PIN-only deployment.

### D9 — `CodeFailedPrecondition` + `PreconditionFailure`, not a new `CodeUnauthenticated` variant

**Decision**:

```go
ErrSSOProviderNotEnabled = errors.New("this sign-in method is not enabled for this workspace")
```

mapped in `ToConnectError` to `connect.CodeFailedPrecondition` carrying
`errdetails.PreconditionFailure{Violations: [{Type: "SSO_PROVIDER_NOT_ENABLED",
Subject: "<google|apple>", Description: "…"}]}`. The provider name must be threaded into the
error, so the mapping is done where the provider is known — a small typed error
`ssoProviderNotEnabledError{provider string}` wrapping the sentinel, in the same shape as the
existing `ErrAccountLocked`.

**Rationale**: `ErrInvalidSSOToken` already maps to `CodeUnauthenticated`, and FR-024 requires
the two be distinguishable. A different code is the clearest possible distinction and needs no
client string-matching. `PreconditionFailure` is the right well-known detail — the precondition
is "this provider is enabled here" — and both halves of the plumbing already exist:
`internal/collaboration/connect.go` attaches them, and
`frontend/packages/apis/src/errorDetails.ts` exports `extractPreconditionViolations` returning
`{type, subject, description}`. So the cross-stack cost is one constant and one `case` in the
web error copy.

`[ASSUMPTION: the violation Type string is SSO_PROVIDER_NOT_ENABLED and the Subject is the
lowercase provider id already used by SSOProviderGoogle/SSOProviderApple ("google", "apple"),
matching the SCREAMING_SNAKE type / lowercase subject convention the collaboration domain's
existing PreconditionFailure violations use.]`

**Alternatives considered**:
- `CodeUnimplemented` — technically defensible, but it reads to a client as "this server is
  too old", which invites a retry against a different host rather than a configuration fix.
- A new field on an existing proto message — a proto change and a `buf generate` cycle for
  something `google.rpc` already models.

### D10 — Development entry points declare the profile in the Makefile target

**Decision**: `make voice-dev-backend` runs `APP_ENV=development go run ./cmd server`.
`backend/.env.example` also gains `APP_ENV=development` with a comment, so a contributor who
copies it gets the same result when running the binary by hand.

**Rationale**: the Makefile target is the single documented way to start the backend locally —
`README.md:24`, `CONTRIBUTING.md:64`, `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md:151`
and `frontend/apps/mobile/scripts/with-lan-ip.sh:28` all point at it, and `make check-backend`
tells you to use it when the server is down. Setting it there satisfies FR-005 for every
contributor without touching a file they may already have diverged locally.

`[ASSUMPTION: APP_ENV is set in the Makefile target rather than emitted by
backend/scripts/dev/voice-env.sh. voice-env.sh is eval'd by the two test targets as well, and
those start no server — putting a profile declaration in a script named for voice
configuration would be the less obvious place for the next person to look.]`

**Alternatives considered**:
- Relying on `backend/.env.example` alone — a contributor with an existing `.env` from before
  this change would not pick it up and would hit a startup failure on their next pull.
- Defaulting to development when `os.Getenv("APP_ENV")` is empty *and* a `.env` file was
  found — clever, invisible, and it would reintroduce exactly the "unsafe state you get by
  not thinking about it" this feature removes.

### D11 — FR-026 needs the raw environment value, so `Config` keeps both

**Decision**: `Config` gains `GoogleClientIDsRaw` and `AppleClientIDsRaw` alongside the parsed
slices. The audience check reports a violation when the raw string is non-blank but the parsed
slice is empty — that is, the operator wrote something and none of it was usable.

**Rationale**: `getEnvStringSlice` deliberately drops blank entries, so `" , "` and unset both
arrive as `nil`. Those two cases must be told apart: unset means "this provider is not used
here" (legitimate, FR-028), while `" , "` means "someone tried to configure this and it did not
take" (a misconfiguration, FR-026). Two extra string fields is the smallest way to keep the
distinction; a wrapper type would be an abstraction with two uses.

**Alternatives considered**:
- Re-reading `os.Getenv` inside the check — works, but silently ignores `.env`-loaded values in
  a way that would only bite someone debugging locally, and makes the check untestable without
  mutating process environment.

## Out of scope, confirmed

The spec's assumption that the voice service's development credential defaults
(`LIVEKIT_KEYS=devkey:…`) and silently-disabled push notifications are out of scope is
adopted unchanged. Both are visible in `docs/domain/platform.md`'s configuration table and are
the natural fourth and fifth checks; the report's shape takes them without restructuring. This
plan does not add them.
