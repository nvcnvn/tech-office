# Phase 1 Data Model: Production Safety Defaults

**No database entity, no migration, no `schema.sql` change.** Everything below is
process-local in-memory state derived from the environment at startup. It is recorded here
because the spec names three key entities and because the shapes are the contract between
`internal/config`, `cmd/server.go` and `internal/iam`.

## `config.Profile`

```go
// Profile is the declared runtime posture of this process. It is the only input that
// decides whether a failing safety check is fatal.
type Profile string

const (
    ProfileDevelopment Profile = "development"
    ProfileProduction  Profile = "production"
)
```

**Source**: `APP_ENV`, stored raw on `Config.AppEnvRaw`.

**Resolution** — `ParseProfile(raw string) (Profile, error)`:

| Trimmed raw value | Result |
|---|---|
| `""` (absent or empty) | `ProfileProduction`, no error — FR-002 |
| `"development"` | `ProfileDevelopment` |
| `"production"` | `ProfileProduction` |
| anything else (`prod`, `Production`, `dev`, `staging`, `test`) | error naming the value and listing the two accepted values — FR-003 |

Leading and trailing whitespace is trimmed; the comparison is otherwise exact and
case-sensitive, so `Production` is a typo and not a synonym.

**Lifetime**: resolved once in `EnforceSafety`, logged once at `Info` (FR-004), and passed by
value to anything that needs it. Not cached on `Config` — a second caller re-parsing a string
is cheaper than a second source of truth.

## `config.SafetyViolation`

```go
// SafetyViolation is one failed startup-time assertion about configuration.
// Every field is operator-facing prose or an environment variable name. No field
// ever holds a configured value, because a configured value may be a secret (FR-012).
type SafetyViolation struct {
    Check    string // stable identifier: "durable-signing-key" | "cross-origin" | "sso-audience"
    Setting  string // the environment variable to change
    Exposure string // what the current state exposes, in one sentence
    Fix      string // what a correct value looks like
}
```

**Invariants**

- `Setting` is always a real environment variable name that appears in `deploy/.env.example`.
- `Exposure` and `Fix` are non-empty for every violation (FR-011).
- No field is ever interpolated from a configuration *value*. The messages name settings and
  describe shapes; they never echo `JWT_PRIVATE_KEY_PATH`'s contents, a client ID, or a
  connection string (FR-012). `WEBAPP_URL`'s value is the one exception considered and
  rejected — even a hostname is not echoed, because the `Fix` text can describe the required
  shape without it.

**The three checks at introduction**

| `Check` | `Setting` | Fails in production when |
|---|---|---|
| `durable-signing-key` | `JWT_PRIVATE_KEY_PATH` | the value is empty, so a per-process key would be generated (FR-013). A value that is set but unreadable is *not* this check's business — `iam.NewInternalJWTSigner` still fails startup on it, in every profile (FR-015). |
| `cross-origin` | `WEBAPP_URL` / `CORS_ALLOWED_ORIGINS` | the effective origin list is `["*"]` or contains `"*"` (FR-017), **or** `WEBAPP_URL` is empty, unparseable, or loopback (FR-018). Reported as at most one violation even when both hold, because the fix is the same edit. |
| `sso-audience` | `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | the raw value is non-blank but yields no usable entries after trimming (FR-026). One violation per affected provider. An entirely unset provider yields none — it is disabled, not misconfigured (FR-028). |

**Ordering**: `SafetyViolations` appends in the order above and within the SSO check appends
Google before Apple, so the report is deterministic and a test can assert on the whole slice.

## `config.SafetyReport`

Modelled as the return value `[]SafetyViolation` rather than a named struct — the report *is*
the complete set of failures for this process, and a wrapper type would add a field nobody
reads.

**State transitions** (`EnforceSafety(ctx) error`):

```
                 ┌── ParseProfile fails ──────────────────► return error (exit 1)
                 │
config.Get() ────┤                    ┌── len == 0 ──────► return nil ──► server starts
                 │                    │
                 └── profile OK ──► violations
                    (log profile)     │
                                      ├── production ────► return one error containing
                                      │                     every violation (exit 1)
                                      └── development ───► one slog.Warn per violation,
                                                            return nil ──► server starts
```

Both terminal paths happen before `database.NewAdminPool` and before `net.Listen`
(FR-007, FR-008, SC-001). A development start with violations is indistinguishable from
today's start except for the wording of the warnings (FR-009, SC-004).

## `iam.JWKSVerifier` — provider enablement

The verifier already holds `googleAudiences []string` and `appleAudiences []string`. The
change is what an empty slice *means*.

| Audience slice | Today | After |
|---|---|---|
| empty | JWKS fetched at boot; tokens accepted with **no** audience check | JWKS **not** fetched; every verify and every link returns `ErrSSOProviderNotEnabled` (FR-023, FR-025) |
| non-empty | JWKS fetched; audience compared | unchanged (FR-025, US2 AS2) |

A nil `jwksPool` for a disabled provider is the in-memory representation. `EnabledProviders()
[]string` returns the enabled subset in a fixed order for the startup log line (FR-027).

## What is deliberately *not* modelled

- **No persisted record of a start attempt.** SC-003 is about one restart showing one complete
  list, not about history. The process exits; the log line is the artifact.
- **No per-check severity.** Every violation is fatal in production and a warning in
  development. A severity field would be a knob with one setting.
- **No third profile.** Per the spec's assumption, a staging deployment declares `production`.
