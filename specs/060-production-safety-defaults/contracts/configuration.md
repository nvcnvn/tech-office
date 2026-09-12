# Contract: Configuration

The operator-facing interface of this feature is a set of environment variables. This is the
contract `deploy/.env.example` and `docs/domain/platform.md` must both describe (FR-030).

## New settings

### `APP_ENV`

| | |
|---|---|
| Accepted values | `development`, `production` — exactly these two, case-sensitive, surrounding whitespace trimmed |
| When unset or empty | `production` (FR-002) |
| When anything else | **startup fails**, and the message lists the two accepted values (FR-003) |
| Effect | The only input that decides whether a failing safety check aborts startup |

Declared as `production` in `deploy/stacks/core.yml` and in `deploy/.env.example`, so an
operator reading either file can see the setting exists (FR-006). Declared as `development`
by `make voice-dev-backend` and in `backend/.env.example` (FR-005).

### `CORS_ALLOWED_ORIGINS`

| | |
|---|---|
| Format | Comma-separated list of browser origins, e.g. `https://admin.example.com,https://kiosk.example.com` |
| When unset, empty, or whitespace-only | No additional origins; the list is just the origin derived from `WEBAPP_URL` |
| Effect | Appended to the derived origin in the production profile. Ignored in development, where every origin is permitted |
| Rejected | A literal `*` anywhere in the list fails the cross-origin check in production (FR-017) |

Only needed by a deployment that serves its browser clients from more than one origin
(FR-019). A single-domain deployment sets nothing.

## Settings whose meaning changes

### `WEBAPP_URL`

Already required, already set to `https://${WEB_DOMAIN}` by `deploy/stacks/core.yml`. It now
also determines the allowed browser origin in production. Its origin — scheme, host and port,
with the path and anything after it discarded, and no trailing slash — is the first entry in
the allowed-origin list.

In the production profile the server refuses to start when `WEBAPP_URL` is empty, is not an
absolute URL with a scheme and a host, or resolves to a loopback host (`localhost`,
`127.0.0.0/8`, `::1`, `0.0.0.0`). Private LAN addresses and `.local`/`.internal` names are
accepted — see research decision D7.

### `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`

| Value | Before | After |
|---|---|---|
| unset / empty | Provider accepted, audience check **skipped** | Provider **disabled**: every token exchange and identity link for it is refused (FR-023) |
| set, but only blanks (`" , "`) | Same as unset | **Startup fails** in production (FR-026); a warning in development |
| set with real client IDs | Audience checked | Unchanged |

A deployment that signs people in with workspace passwords and worker PINs only sets neither
variable and starts normally under `APP_ENV=production` (FR-028, SC-006).

### `JWT_PRIVATE_KEY_PATH`

| Value | Before | After |
|---|---|---|
| unset | Ephemeral key, warning logged | **Startup fails** in production (FR-013); a warning in development, which is today's behaviour |
| set but unreadable or invalid | Startup fails | Unchanged, in every profile including development (FR-015) |
| set and valid | Signer built | Unchanged |

Already set to `/run/secrets/jwt.pem` by `deploy/stacks/core.yml`, so an existing deployment
passes this check with no edit.

## Settings this feature does not touch

`SERVER_PORT`, `METRICS_PORT`, `DATABASE_URL`, `R2_*`, `SES_*`, `LIVEKIT_*`, `APNS_VOIP_*`,
`GOOGLE_APPLICATION_CREDENTIALS`. The voice development-credential default and the silent
disabling of push notifications are acknowledged as the same class of problem and are
explicitly out of scope — see the spec's assumptions and research §"Out of scope, confirmed".

## Breaking-change notice

This is a breaking change. A deployment that today starts with an ephemeral signing key, a
loopback `WEBAPP_URL`, or a half-filled audience list will refuse to start after this change
unless it declares `APP_ENV=development`. Deployments built from `deploy/stacks/core.yml`
already satisfy the signing-key and workspace-address checks; the practical migration is
adding `APP_ENV=production` to `deploy/.env` and, for deployments using Google or Apple
sign-in, filling in the audience lists that were previously optional.
