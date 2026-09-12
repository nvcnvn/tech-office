# Contract: Startup safety report

The report is an operator-facing interface: SC-002 requires that someone reading the failure
can fix every flagged setting without opening source code. That makes the wording part of the
contract, not an implementation detail.

## Always: one line naming the profile

Emitted at `Info` before anything else, in every profile (FR-004):

```
INF runtime profile resolved profile=production
```

## Always: one line naming provider enablement

Emitted at `Info` in every profile, after the profile line (FR-027):

```
INF identity providers resolved enabled=[] disabled=[google apple] reason="no audiences configured"
```

An operator scanning a fresh deployment's first ten lines sees which sign-in methods exist
without grepping for an absence.

## Production profile, violations present: refuse to start

The process writes one message and exits non-zero, having bound no port and opened no database
connection. Shape:

```
tech-office: refusing to start in the production profile — 3 safety checks failed.

  1. JWT_PRIVATE_KEY_PATH is not set.
     Exposes: session tokens are signed with a key generated for this process, so every
              signed-in person is signed out when the server restarts, and two replicas
              reject each other's tokens.
     Fix:     point it at a readable PEM-encoded RSA private key that outlives the process
              — the Swarm stack mounts one at /run/secrets/jwt.pem.

  2. WEBAPP_URL is http://localhost — a loopback address.
     Exposes: the allowed browser origin is derived from this address, so no browser on any
              other machine could ever be allowed to call this server.
     Fix:     set it to the address people type to reach the workspace, e.g.
              https://office.example.com. Add CORS_ALLOWED_ORIGINS for any further origin.

  3. GOOGLE_CLIENT_IDS is set but contains no usable entry.
     Exposes: Google sign-in appears to be configured and is not, so it is refused at the
              moment somebody tries to use it rather than now.
     Fix:     set it to a comma-separated list of the OAuth client IDs your apps use, or
              unset it entirely to turn Google sign-in off deliberately.

Set APP_ENV=development to run with these defaults on a developer's machine.
```

**Required properties**

- **Every** violation appears; the report never stops at the first (FR-010, SC-003).
- Each entry names the setting, what the current state exposes, and what a correct value looks
  like (FR-011).
- No configured value that could be a secret is echoed. Naming `WEBAPP_URL`'s loopback host is
  allowed and useful; a client ID, a key path's contents, or a connection string is not
  (FR-012).
- Exit status is non-zero. `main.go` already routes a non-nil action error through `log.Fatal`,
  which exits 1.
- Nothing is listening. The message is produced before `database.NewAdminPool` and before
  `net.Listen` (FR-007, FR-008, SC-001).

## Development profile, violations present: start, and warn

One `slog.Warn` per violation, then the server starts exactly as it does today (FR-009, SC-004):

```
WRN safety check would fail in the production profile check=durable-signing-key setting=JWT_PRIVATE_KEY_PATH exposes="…" fix="…"
WRN safety check would fail in the production profile check=cross-origin setting=WEBAPP_URL exposes="…" fix="…"
WRN safety check would fail in the production profile check=sso-audience setting=GOOGLE_CLIENT_IDS exposes="…" fix="…"
```

The message text states the production consequence explicitly, so a contributor sees the
production verdict on their own machine (US3).

## Profile itself invalid: refuse to start, in any case

Resolved before any check, because the checks' severity depends on it:

```
tech-office: APP_ENV="Production" is not a runtime profile. Accepted values: development, production.
```

## What replaces what

These three lines in `backend/cmd/server.go` are **deleted**, not supplemented — the report is
the only thing that speaks about these settings at startup:

- `JWT_PRIVATE_KEY_PATH not set, using ephemeral key (dev only)`
- `GOOGLE_CLIENT_IDS not set — Google token audience validation disabled (dev only)`
- `APPLE_CLIENT_IDS not set — Apple token audience validation disabled (dev only)`
