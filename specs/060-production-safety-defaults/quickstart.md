# Quickstart: validating Production Safety Defaults

Runnable scenarios that prove the feature works. Shapes and wording come from
[contracts/](contracts/); entity definitions from [data-model.md](data-model.md).

## Prerequisites

```bash
make infra-up          # PostgreSQL, ClamAV, Gotenberg
```

Local development is driven through the repository's supported tooling; do not improvise a
different way to start the server.

## 1. The development loop is unchanged (US3, SC-004)

```bash
make voice-dev-backend
```

**Expect**: the server starts and serves on `:18080`, exactly as before. In the first few
lines of the log:

- `runtime profile resolved profile=development`
- `identity providers resolved enabled=[] disabled=[google apple] …`
- one `safety check would fail in the production profile` warning per unsafe default. With
  a `backend/.env` copied from `backend/.env.example` that is exactly one, for
  `WEBAPP_URL` (`http://localhost:13000` is loopback) — the example file points
  `JWT_PRIVATE_KEY_PATH` at `.dev-keys/jwt-private.pem`, so the signing-key check passes,
  and `GOOGLE_CLIENT_IDS` only warns if you have a half-filled audience list.
  [ASSUMPTION: the plan's "three warnings" reads the defaults as all-unsafe; the checked-in
  example file is safer than that, so the count is written as "one per unsafe default"
  rather than a fixed three.]

**Expect not**: any additional setup step compared to today. Zero new configuration.

Confirm the permissive origin policy still holds:

```bash
curl -i -X OPTIONS http://localhost:18080/rpc.v1.IAMService/Login \
  -H 'Origin: http://some-random-host:9999' \
  -H 'Access-Control-Request-Method: POST'
```

**Expect**: `Access-Control-Allow-Origin: *` (FR-020).

## 2. An insecure production deployment refuses to serve (US1, SC-001, SC-003)

Run the server binary directly with a deliberately unsafe production configuration. Nothing
is started, so no port is occupied and it is safe to run alongside your dev server.

```bash
cd backend
APP_ENV=production \
  JWT_PRIVATE_KEY_PATH= \
  WEBAPP_URL=http://localhost:13000 \
  GOOGLE_CLIENT_IDS=' , ' \
  go run ./cmd server
echo "exit status: $?"
```

**Expect**:

- exit status `1`
- one message listing **three** violations, not one (FR-010)
- each entry naming its setting, what the current state exposes, and a correct value (FR-011)
- nothing listening: `lsof -i :18080` shows only your dev server from step 1, or nothing
- no `successfully connected to privilege database` line — the gate runs before the pools

Verify the report holds no secret (FR-012):

```bash
APP_ENV=production JWT_PRIVATE_KEY_PATH= WEBAPP_URL=http://localhost:13000 \
  go run ./cmd server 2>&1 | grep -iE 'BEGIN (RSA )?PRIVATE KEY|apps.googleusercontent.com|postgres://'
```

**Expect**: no matches.

## 3. A safe production configuration serves normally (US1 AS5, SC-006)

```bash
cd backend
APP_ENV=production \
  JWT_PRIVATE_KEY_PATH=.dev-keys/jwt-private.pem \
  WEBAPP_URL=https://office.example.com \
  SERVER_PORT=18085 METRICS_PORT=18095 \
  go run ./cmd server
```

Note that neither `GOOGLE_CLIENT_IDS` nor `APPLE_CLIENT_IDS` is set: this is the
password-and-PIN-only deployment of SC-006, and it must start.

**Expect**: `runtime profile resolved profile=production`, no violation output, the server
serving on `:18085`. (`18081` is Gotenberg's port in the dev compose stack — do not reuse
it.) Then, from another shell:

```bash
curl -sf http://localhost:18085/healthz && echo OK              # no Origin header — FR-021
curl -i -X OPTIONS http://localhost:18085/rpc.v1.IAMService/Login \
  -H 'Origin: https://office.example.com' -H 'Access-Control-Request-Method: POST'
curl -i -X OPTIONS http://localhost:18085/rpc.v1.IAMService/Login \
  -H 'Origin: https://evil.example.com' -H 'Access-Control-Request-Method: POST'
curl -sf http://localhost:18095/metrics | head -3                # FR-021, unaffected listener
```

**Expect**: health probe and metrics answer; the workspace origin is echoed in
`Access-Control-Allow-Origin`; the unlisted origin gets no such header, so a browser refuses
the response (SC-007).

Check the profile rejects a typo (FR-003):

```bash
APP_ENV=Production go run ./cmd server; echo "exit status: $?"
```

**Expect**: exit `1`, message listing `development, production`.

## 4. An unconfigured provider is refused, not trusted (US2, SC-005)

Against the development server from step 1, which has no audiences configured:

Any token value will do — the provider is refused *before* the token is parsed, which is
the point.

```bash
curl -s -X POST http://localhost:18080/rpc.v1.IAMService/ExchangeToken \
  -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -d '{"provider":"SSO_PROVIDER_GOOGLE","idToken":"any.token.at.all"}' | jq
```

**Expect**: `FAILED_PRECONDITION`, the message `this sign-in method is not enabled for this
workspace`, and a `google.rpc.PreconditionFailure` detail with
`type: "SSO_PROVIDER_NOT_ENABLED"`, `subject: "google"` — see
[contracts/sso-provider-disabled.md](contracts/sso-provider-disabled.md). **Not**
`UNAUTHENTICATED`, and no user row created.

Confirm password and PIN sign-in are untouched by signing in normally through the web app.

## 5. The test suites

```bash
cd backend && go test ./internal/config/    # the startup verdict table
make test-backend                           # full integration suite, incl. production_safety_test.go
make test-frontend                          # Playwright — unchanged by this feature
```

**Expect**: zero failures across the whole of each suite, not just the new tests. The feature
is done only when both suites are green (Constitution II).

[ASSUMPTION: no Playwright spec was added or changed. The web sign-in page hides a provider
button whose `NEXT_PUBLIC_*_CLIENT_ID` is unset, so the disabled-provider copy is
unreachable from the UI on a coherently configured deployment; driving it would need a
harness rather than a scenario. The copy is covered at the API-wrapper layer and the wire
contract by `the refusal carries the provider name in its error detail` in
`backend/integration/production_safety_test.go`.]

## 6. Documentation is current (FR-029, SC-008)

```bash
grep -rn "CORS is currently\|logged as dev-only\|audience validation is opt-in\|must not ship" \
  docs/domain/platform.md docs/domain/auth-identity.md
```

**Expect**: no matches. Those three statements must be gone, replaced by the profile and the
three checks. No drift-register row in `docs/domain/README.md` covers these, so none needs
deleting.

A bare `AllowAll` still appears in `platform.md`, and correctly so: the production handler
*is* `cors.AllowAll()`'s option set with `AllowedOrigins` replaced, and saying so is what
tells a reader nothing else about the middleware changed.

Also check the engineering references mandated by Constitution XII:

```bash
grep -n "logs those\|logs it loudly\|logs loudly" backend/docs/PRODUCTION-DAY1-CHECKLIST.md
```

**Expect**: the placeholder-secret item no longer claims the backend merely logs the problem
loudly, and the checklist has an item for declaring `APP_ENV=production`.
