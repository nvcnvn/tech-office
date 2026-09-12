# Tasks: Production Safety Defaults

**Input**: Design documents from `/specs/060-production-safety-defaults/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. Principle II (Scenario-First Integration & E2E Testing) is binding for
this repository, and plan.md's *Testing Strategy* names the exact `t.Run` scenarios to write
as stubs before implementation. Test tasks below create those stubs first.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested and
shipped on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are given in every task

## Path Conventions

Existing repository layout, unchanged by this feature:

- Backend Go service: `backend/cmd/`, `backend/internal/`, `backend/integration/`
- Web client: `frontend/apps/web/`, shared API wrappers in `frontend/packages/apis/src/`
- Deployment: `deploy/.env.example`, `deploy/stacks/core.yml`
- Living documentation: `docs/domain/`, engineering references in `backend/docs/`

**No database change.** No migration, no `schema.sql` regeneration, no `buf generate` cycle,
no new dependency.

---

## Assumptions recorded during task generation

- [ASSUMPTION: plan.md's *Testing Strategy* says "the existing sign-in spec gains one
  assertion" in `frontend/apps/web/e2e/`. No sign-in spec exists there — the directory holds
  no `signin`/`auth` spec, and the disabled-provider error is unreachable from the web UI
  because `frontend/apps/web/src/app/signin/page.tsx` already hides a provider button whose
  `NEXT_PUBLIC_*_CLIENT_ID` is unset. Creating a new Playwright spec purely to drive an
  unreachable state would be a harness, not a scenario. The copy is therefore covered at the
  API-wrapper layer (T026) and the wire contract by the integration scenario (T019), and no
  web E2E task is generated. Raise this at review if a sign-in E2E spec is wanted on its own
  merits.]
- [ASSUMPTION: `ParseProfile` and the dev-profile warning branch are split across phases —
  US1 delivers the production-fatal branch and US3 adds the development-warning branch to the
  same `EnforceSafety` function. Between the two, the development profile resolves and logs
  but reports nothing, which is exactly today's behaviour, so US1 is shippable alone and US3
  remains an independent increment.]
- [ASSUMPTION: `backend/internal/config/safety_test.go` sets its inputs by constructing a
  `config.Config` value directly rather than mutating process environment with `t.Setenv`,
  because `config.Get()` is a `sync.Once` singleton that cannot be re-loaded within one test
  binary. `ParseProfile` takes a raw string and the checks are methods on `*Config`, so this
  needs no test seam.]

## Assumptions recorded during implementation

- [ASSUMPTION: `EnforceSafety` returns `(Profile, error)` rather than the `error` T004
  specifies. The resolved profile is needed at the `withCORS` call site (T016), and
  data-model.md says the profile is "resolved once in `EnforceSafety` … and passed by value
  to anything that needs it". Returning it is one extra value; the alternative was calling
  `ParseProfile` a second time in `server.go` and discarding an error already known to be
  nil.]
- [ASSUMPTION: `VerifyGoogleToken` and `VerifyAppleToken` were **deleted** rather than
  edited in place as T023 describes, and replaced by one unexported
  `verifyToken(ctx, provider, pool, audiences, idToken)` that `VerifyProviderToken`
  dispatches to. Nothing in the repository called either method — `VerifyProviderToken` was
  the only caller — so keeping them would have left two dead wrappers around duplicated
  logic that the disabled-provider guard would have to be added to twice. Per the project's
  no-backward-compatibility stance, the unused public surface goes.]
- [ASSUMPTION: the numbered entry in the startup report is the `Setting` name alone
  ("1. JWT_PRIVATE_KEY_PATH"), not the prose headline shown in
  `contracts/startup-report.md` ("1. WEBAPP_URL is http://localhost — a loopback
  address."). T015 specifies "a numbered `Setting` / `Exposes:` / `Fix:` block", and
  data-model.md records that echoing even a hostname was "considered and rejected" under
  FR-012, which the contract's example headline would violate. The cause is carried by the
  `Exposure` sentence instead, which names loopback without naming the host.]
- [ASSUMPTION: where both halves of the cross-origin check fail, the wildcard entry in
  `CORS_ALLOWED_ORIGINS` is the one reported. data-model.md mandates at most one
  `cross-origin` violation; a wildcard is the more severe of the two and is reported first.]
- [ASSUMPTION: `config.SafetyViolations` takes the profile but does not branch on it — every
  check is profile-independent, and only the severity in `EnforceSafety` differs. T013's
  "return nil immediately for `ProfileDevelopment`" was superseded by T029, which needs the
  full list in development, so the parameter is retained (unused) for a future check that is
  genuinely profile-specific rather than removed.]
- [ASSUMPTION: the disabled-provider error is mapped inside the `rpcCall` callback in
  `frontend/packages/apis/src/iam.ts` rather than around it. `rpcWrapper.ts` flattens an
  unhandled Connect code into a `NetworkError`, and `FAILED_PRECONDITION` has no case, so
  catching after `rpcCall` would find the structured detail already gone.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture the raw environment values every later phase reads. Nothing else is
needed — no project initialization, no new dependency, no linting change.

- [X] T001 Add `AppEnvRaw`, `CORSAllowedOrigins`, `GoogleClientIDsRaw` and `AppleClientIDsRaw` fields to the `Config` struct in `backend/internal/config/config.go` and populate them in `load()` — `AppEnvRaw: getEnv("APP_ENV", "")`, `CORSAllowedOrigins: getEnvStringSlice("CORS_ALLOWED_ORIGINS")`, `GoogleClientIDsRaw: getEnv("GOOGLE_CLIENT_IDS", "")`, `AppleClientIDsRaw: getEnv("APPLE_CLIENT_IDS", "")`, keeping the existing parsed `GoogleClientIDs`/`AppleClientIDs` slices (research D11: the raw strings are what tells `" , "` apart from unset)

**Checkpoint**: Configuration carries everything the checks need; behaviour unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The runtime profile itself. Every story's severity depends on it, so nothing else
can be built first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Write the `TestRuntimeProfile` scenario stubs in `backend/internal/config/safety_test.go` with the four `t.Run` names from plan.md — "an absent APP_ENV resolves to production", "development and production are the only accepted values", "an unrecognised value is rejected and the error lists the accepted values", "the rejection covers casing and abbreviation typos" — asserting the table in data-model.md and confirming they fail
- [X] T003 Create `backend/internal/config/safety.go` with the `Profile` string type, the `ProfileDevelopment`/`ProfileProduction` constants and `ParseProfile(raw string) (Profile, error)`: trim surrounding whitespace, empty → `ProfileProduction` with no error (FR-002), exact case-sensitive match on the two values, anything else → an error whose message quotes the offending value and lists both accepted values (FR-001, FR-003), making T002 pass
- [X] T004 Add `func (c *Config) EnforceSafety(ctx context.Context) error` to `backend/internal/config/safety.go` — resolve the profile from `c.AppEnvRaw` via `ParseProfile`, return that error unwrapped on failure, otherwise emit one `slog.InfoContext(ctx, "runtime profile resolved", "profile", profile)` (FR-004) and return nil
- [X] T005 Call `cfg.EnforceSafety(ctx)` in `backend/cmd/server.go` as the first statement after `cfg := config.Get()` in `startServer`, returning its error immediately — it must precede `database.NewAdminPool`, `iam.NewJWKSVerifier` and `net.Listen` so a failing process opens no connection and binds no port (FR-007, FR-008, SC-001; `main.go` already routes a non-nil action error through `log.Fatal`, giving exit 1)

**Checkpoint**: The profile exists, is logged, and a typo in `APP_ENV` stops the process before anything is opened. No check is evaluated yet.

---

## Phase 3: User Story 1 - An insecure deployment refuses to serve traffic (Priority: P1) 🎯 MVP

**Goal**: In the production profile, the three safety checks are evaluated before any port is
bound and a single message names every violation at once; a safe configuration serves exactly
as it does today.

**Independent Test**: Run `go test ./internal/config/...` from `backend/` and confirm the
production verdict table passes, including the three-simultaneous-violations case. Then start
the server with `APP_ENV=production`, `JWT_PRIVATE_KEY_PATH` unset and a loopback
`WEBAPP_URL`, and confirm it exits non-zero with all violations listed and nothing listening
on `SERVER_PORT`. Finally start it with a safe configuration and confirm normal service.

### Tests for User Story 1 ⚠️

> Write these stubs FIRST and confirm they fail before implementing T009–T017.

- [X] T006 [P] [US1] Add the `TestStartupSafetyReport` production subtests to `backend/internal/config/safety_test.go` using the `t.Run` names in plan.md — unset signing key is a violation; the signing-key violation states sessions die on restart and differ across replicas; a wildcard origin list is a violation; a loopback `WEBAPP_URL` is a violation; an absent `WEBAPP_URL` is a violation; a whitespace-only audience list is a violation; an entirely unset provider is not; three simultaneous problems are reported together; every violation names its setting, exposure and a correct value; no violation message contains a secret value; a fully safe configuration reports nothing
- [X] T007 [P] [US1] Add the `TestAllowedOrigins` subtests to `backend/internal/config/safety_test.go` — the workspace address becomes the allowed origin (including trailing-slash and path normalisation per research D5), extra origins are appended after it, a whitespace-only `CORS_ALLOWED_ORIGINS` is treated as empty, and the development profile returns `["*"]`
- [X] T008 [P] [US1] Create `backend/integration/production_safety_test.go` with `TestProductionSafetyDefaults` and the origin-less/streaming subtests from plan.md — "the health probe answers", "an RPC succeeds", "the notification stream stays open and delivers" under `when a request carries no origin header` (FR-021, FR-022) — following the testWorld pattern used by the neighbouring suites, and open the file with the per-FR coverage mapping comment plan.md's *Coverage handoff* requires

### Implementation for User Story 1

- [X] T009 [US1] Add the `SafetyViolation` struct (`Check`, `Setting`, `Exposure`, `Fix`, all operator-facing prose or env-var names, never a configured value) to `backend/internal/config/safety.go` per data-model.md
- [X] T010 [US1] Implement the `durable-signing-key` check in `backend/internal/config/safety.go` — a violation when `c.JWTPrivateKeyPath` is empty, with `Exposure` stating sessions are signed with a per-process key so everyone is signed out on restart and two replicas reject each other's tokens, and `Fix` pointing at a readable PEM RSA key such as the Swarm stack's `/run/secrets/jwt.pem` (FR-013, FR-014); a set-but-unreadable path stays `iam.NewInternalJWTSigner`'s business and is not this check's (FR-015)
- [X] T011 [US1] Implement the `cross-origin` check in `backend/internal/config/safety.go` — one violation at most, raised when the effective production origin list contains `"*"` (FR-017) **or** when `c.WebappURL` is empty, fails `url.Parse` into an absolute URL with scheme and host, or has a loopback host (`localhost`, anything in `127.0.0.0/8`, `::1`, `0.0.0.0`, `[::]`); RFC 1918 private ranges and `.local`/`.internal` names pass, per research D7 (FR-018)
- [X] T012 [US1] Implement the `sso-audience` check in `backend/internal/config/safety.go` — one violation per provider whose raw value (`GoogleClientIDsRaw`, then `AppleClientIDsRaw`) is non-blank after trimming while its parsed slice is empty, meaning the operator configured something unusable (FR-026); a provider left entirely unset yields no violation because it is deliberately disabled (FR-028)
- [X] T013 [US1] Implement `func (c *Config) SafetyViolations(p Profile) []SafetyViolation` in `backend/internal/config/safety.go` — return nil immediately for `ProfileDevelopment` callers that want no report, otherwise append signing-key, cross-origin, then SSO (Google before Apple) with no early return, so the order is deterministic and the whole slice is assertable (FR-010)
- [X] T014 [US1] Implement `func (c *Config) AllowedOrigins(p Profile) []string` in `backend/internal/config/safety.go` — `["*"]` in development (FR-020); in production the origin of `WebappURL` (scheme + host + port, path and trailing slash discarded) followed by each non-blank `CORSAllowedOrigins` entry (FR-016, FR-019), making T007 pass
- [X] T015 [US1] Extend `EnforceSafety` in `backend/internal/config/safety.go` with the production branch — collect `SafetyViolations`, and when non-empty return a single error formatted exactly as `contracts/startup-report.md` specifies: the "refusing to start in the production profile — N safety checks failed" header, a numbered `Setting` / `Exposes:` / `Fix:` block per violation, and the closing `Set APP_ENV=development …` line, echoing no secret value (FR-008, FR-010, FR-011, FR-012), making T006 pass
- [X] T016 [US1] Change `withCORS` in `backend/cmd/server.go:765` to `withCORS(connectHandler http.Handler, origins []string) http.Handler` returning `cors.New` with `AllowedOrigins: origins` and the remaining options verbatim from `cors.AllowAll()` (`AllowedMethods` HEAD/GET/POST/PUT/PATCH/DELETE, `AllowedHeaders: []string{"*"}`, `AllowCredentials: false`) per research D6, and update the call site at `backend/cmd/server.go:719` to pass `cfg.AllowedOrigins(profile)`; leave the separate `METRICS_PORT` server untouched
- [X] T017 [US1] Delete the `JWT_PRIVATE_KEY_PATH not set, using ephemeral key (dev only)` `slog.Warn` at `backend/cmd/server.go:107` — the report is now the only thing that speaks about this setting at startup (`contracts/startup-report.md`, *What replaces what*)

**Checkpoint**: A misconfigured production deployment exits before binding a port with every violation named; a safe one serves as before. This is the MVP and closes SC-001, SC-002 and SC-003 on its own.

---

## Phase 4: User Story 2 - An unconfigured identity provider is refused, not trusted (Priority: P2)

**Goal**: A provider with no configured audiences is disabled rather than audience-unchecked —
its token exchanges and identity links are refused, in every profile, with an error a client
can tell apart from a rejected token. Password and PIN sign-in are untouched.

**Independent Test**: Against the dev server (which runs with no `GOOGLE_CLIENT_IDS`), present
a validly signed Google token to `ExchangeToken` and confirm a `FAILED_PRECONDITION` carrying a
`PreconditionFailure` with `type=SSO_PROVIDER_NOT_ENABLED` and `subject=google`, with no
`iam.user` or `iam.sso_identity` row created. Then sign in with a workspace password and a
worker PIN and confirm both still succeed.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] Add the `when a provider has no configured audiences` subtests to `backend/integration/production_safety_test.go` — "exchanging a token for it is refused as not enabled", "the refusal is distinguishable from a rejected token" (different Connect code from `ErrInvalidSSOToken`'s `UNAUTHENTICATED`), "no account is created or linked by the refused attempt", "linking that provider to an existing account is refused the same way" (FR-023, FR-024, FR-025)
- [X] T019 [P] [US2] Add the `the refusal carries the provider name in its error detail` subtest to `backend/integration/production_safety_test.go`, asserting the `google.rpc.PreconditionFailure` round trip on the wire — `type` is `SSO_PROVIDER_NOT_ENABLED` and `subject` is the lowercase provider id — as Principle X requires
- [X] T020 [P] [US2] Add the `when identity providers are disabled` subtests to `backend/integration/production_safety_test.go` — "workspace password sign-in still succeeds" and "worker PIN sign-in still succeeds" (FR-028, SC-006)

### Implementation for User Story 2

- [X] T021 [US2] Add `SSOProviderNotEnabledType = "SSO_PROVIDER_NOT_ENABLED"` to `backend/internal/iam/constants.go` beside the existing `SSOProviderGoogle`/`SSOProviderApple` at line 34 (Principle VIII)
- [X] T022 [US2] Add `ErrSSOProviderNotEnabled = errors.New("this sign-in method is not enabled for this workspace")` and a typed `ssoProviderNotEnabledError{provider string}` wrapping it to `backend/internal/iam/errors.go`, shaped like the existing `ErrAccountLocked`, and add a case to `ToConnectError` (`backend/internal/iam/errors.go:71`) mapping it to `connect.CodeFailedPrecondition` with an `errdetails.PreconditionFailure` violation carrying `Type: SSOProviderNotEnabledType`, `Subject: <provider>` and the description from `contracts/sso-provider-disabled.md`
- [X] T023 [US2] Change `backend/internal/iam/jwks.go` so an empty audience slice means disabled — `NewJWKSVerifier` (line 49) skips the JWKS fetch and stores a nil pool for that provider, which also unblocks an air-gapped deployment using neither provider; `VerifyGoogleToken` (line 108) and `VerifyAppleToken` (line 133) return `ssoProviderNotEnabledError` before parsing anything when their slice is empty; and the `if len(v.…Audiences) > 0` guards at lines 122 and 147 are **removed** so the audience comparison is unconditional whenever a provider is enabled (FR-023, FR-025, research D8)
- [X] T024 [US2] Add `func (v *JWKSVerifier) EnabledProviders() []string` to `backend/internal/iam/jwks.go` returning the enabled provider ids in fixed Google-then-Apple order, for the startup log line
- [X] T025 [US2] In `backend/cmd/server.go`, delete the two audience `slog.Warn` lines at lines 126–131 and replace the `JWKS verifier initialized (Google, Apple)` line at line 137 with the enablement line from `contracts/startup-report.md` — `slog.InfoContext(ctx, "identity providers resolved", "enabled", …, "disabled", …, "reason", "no audiences configured")` — emitted in every profile (FR-027)
- [X] T026 [US2] In `frontend/packages/apis/src/iam.ts`, map the new error in the `exchangeToken` and `linkSSOIdentity` wrappers using the existing `extractPreconditionViolations` from `frontend/packages/apis/src/errorDetails.ts` (line 234) — match `type === 'SSO_PROVIDER_NOT_ENABLED'` and surface person-facing copy in the style feature 058 established, declaring the type string as a mirrored constant beside the existing `SSOProviderType` at line 20 (Principle VIII)

**Checkpoint**: "Audience validation is off" is now an unreachable state in every profile, and a password-and-PIN-only deployment is unaffected. US1 and US2 both work independently.

---

## Phase 5: User Story 3 - The local development loop keeps working and previews the verdict (Priority: P3)

**Goal**: The documented development commands select the development profile with no extra
setup, the server starts with today's permissive defaults, and every check that would fail in
production is logged as a warning that says so.

**Independent Test**: Run `make voice-dev-backend` on a clean checkout with no extra
configuration and confirm the server starts, that a preflight from an arbitrary origin is
allowed, and that the log contains one "would fail in the production profile" warning per
unsafe default.

### Tests for User Story 3 ⚠️

- [X] T027 [P] [US3] Add the `when the development profile is active` subtest to `backend/integration/production_safety_test.go` — "a preflight from an arbitrary origin is allowed" (FR-020)
- [X] T028 [P] [US3] Add the `when the development profile is active` subtests to `backend/internal/config/safety_test.go` — "the same violations are reported but are not fatal" and "each warning states it would prevent startup in production" (FR-009)

### Implementation for User Story 3

- [X] T029 [US3] Extend `EnforceSafety` in `backend/internal/config/safety.go` with the development branch — evaluate the same violations and emit one `slog.WarnContext(ctx, "safety check would fail in the production profile", "check", …, "setting", …, "exposes", …, "fix", …)` per violation, then return nil so the server starts exactly as today (FR-009, SC-004), making T028 pass; adjust `SafetyViolations` from T013 so the development profile gets the full list rather than nil
- [X] T030 [US3] Set `APP_ENV=development` on the `voice-dev-backend` target in `Makefile` (line 322) so every contributor following `README.md`, `CONTRIBUTING.md` and `make check-backend`'s hint gets the development profile with no configuration (FR-005, research D10)
- [X] T031 [P] [US3] Add `APP_ENV=development` with an explanatory comment to `backend/.env.example`, next to the existing `WEBAPP_URL` at line 7, for contributors running the binary by hand (FR-005)
- [X] T032 [P] [US3] Add `APP_ENV: production` and `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}` to the server service environment in `deploy/stacks/core.yml`, beside the existing `WEBAPP_URL` and `JWT_PRIVATE_KEY_PATH` at lines 192–200 (FR-006)
- [X] T033 [P] [US3] Document `APP_ENV`, `CORS_ALLOWED_ORIGINS`, the changed meaning of `WEBAPP_URL`, `GOOGLE_CLIENT_IDS`/`APPLE_CLIENT_IDS` and `JWT_PRIVATE_KEY_PATH`, and the breaking-change notice in `deploy/.env.example` (around the existing `GOOGLE_CLIENT_IDS` at line 192), reproducing the tables in `contracts/configuration.md` including what happens when each is left unset (FR-030)

**Checkpoint**: All three stories are independently functional. The development loop is unchanged in effort and now previews the production verdict.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Living documentation (Constitution XII, FR-029, SC-008) and final verification.
The documentation tasks are part of the Definition of Done, not follow-up work.

- [X] T034 [P] Update `docs/domain/platform.md` — describe the `APP_ENV` profile and the three startup checks, and **delete** the statements that describe these as dev-only warnings, including the "CORS is currently `AllowAll`" claim and any "must not ship that way" wording (FR-029, SC-008)
- [X] T035 [P] Update `docs/domain/auth-identity.md` — record that a provider with no configured audiences is disabled rather than audience-unchecked, document the `FAILED_PRECONDITION` / `SSO_PROVIDER_NOT_ENABLED` contract, and **delete** the "audience validation is opt-in" statement (FR-029, SC-008)
- [X] T036 [P] Add the startup gate to the boot sequence in `backend/docs/SYSTEM-ARCHITECTURE.md` — the safety report runs before the admin pool and before `net.Listen` (Constitution XII)
- [X] T037 [P] Update `backend/docs/PRODUCTION-DAY1-CHECKLIST.md` — the "the backend logs it loudly" line is no longer true; add the `APP_ENV=production` item and the three checks an operator must satisfy
- [X] T038 Run `gofmt` and `go vet ./...` from `backend/`, then `go test ./internal/config/...` and the integration suite per the repository's `make` targets, confirming no failures
- [X] T039 Walk `specs/060-production-safety-defaults/quickstart.md` end to end and confirm every step behaves as written, correcting the quickstart if the implementation landed differently

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 can start immediately
- **Foundational (Phase 2)**: Depends on T001 — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2. No dependency on US2 or US3
- **User Story 2 (Phase 4)**: Depends on Phase 2 only. Fully independent of US1 — the IAM changes touch no file US1 touches except `backend/cmd/server.go`, and different regions of it
- **User Story 3 (Phase 5)**: Depends on Phase 2, and on T013/T015 from US1 for the violation list it warns about
- **Polish (Phase 6)**: Depends on the stories whose behaviour it documents; T034 and T036 need US1, T035 needs US2

### User Story Dependencies

- **US1 (P1)**: Independent. Ships alone as the MVP
- **US2 (P2)**: Independent of US1. Could ship first if desired
- **US3 (P3)**: Reuses US1's `SafetyViolations`; sequence US1 before US3

### Within Each User Story

- Scenario stubs are written and confirmed failing before implementation (Principle II)
- `SafetyViolation` (T009) before the individual checks (T010–T012)
- The checks before the aggregator (T013) and the report formatting (T015)
- `AllowedOrigins` (T014) before the `withCORS` signature change (T016)
- The IAM constant and error (T021, T022) before the verifier change (T023)

### Parallel Opportunities

- T006, T007 and T008 are three independent stub sets — T008 is a different file entirely
- T018, T019 and T020 are all stub additions to one new file; treat them as sequential edits to `production_safety_test.go` if one person writes them, parallel if the file is split by subtest block first
- T010, T011 and T012 are three separate check functions in one file — parallelisable by function, sequential by file
- T031, T032 and T033 touch three different configuration files and are genuinely parallel
- T034, T035, T036 and T037 are four different documentation files and are genuinely parallel
- Once Phase 2 is done, US1 and US2 can be built by two people simultaneously

---

## Parallel Example: User Story 1

```bash
# Write all three stub sets together, confirm they fail:
Task: "TestStartupSafetyReport production subtests in backend/internal/config/safety_test.go"
Task: "TestAllowedOrigins subtests in backend/internal/config/safety_test.go"
Task: "TestProductionSafetyDefaults origin-less and streaming subtests in backend/integration/production_safety_test.go"

# Then the three checks, one function each in backend/internal/config/safety.go:
Task: "durable-signing-key check"
Task: "cross-origin check"
Task: "sso-audience check"
```

## Parallel Example: Phase 6

```bash
Task: "Update docs/domain/platform.md"
Task: "Update docs/domain/auth-identity.md"
Task: "Update backend/docs/SYSTEM-ARCHITECTURE.md"
Task: "Update backend/docs/PRODUCTION-DAY1-CHECKLIST.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 — Setup
2. T002–T005 — Foundational (the profile exists and gates startup)
3. T006–T017 — User Story 1
4. **STOP and VALIDATE**: a misconfigured production start exits non-zero with every violation
   named and nothing listening; a safe start serves normally
5. Ship — SC-001, SC-002 and SC-003 are closed

### Incremental Delivery

1. Setup + Foundational → the profile is declared and logged
2. US1 → an insecure deployment cannot serve traffic (**MVP**)
3. US2 → "audience validation is off" becomes an unreachable state (SC-005, SC-006)
4. US3 → the development loop is unchanged and previews the verdict (SC-004)
5. Polish → the living documentation matches the shipped behaviour (SC-008)

### Parallel Team Strategy

1. One person does T001–T005 (Setup + Foundational)
2. Then Developer A takes US1 (`internal/config`, `cmd/server.go` CORS and signing-key warn)
   while Developer B takes US2 (`internal/iam`, `cmd/server.go` SSO log block,
   `packages/apis`). Their `cmd/server.go` edits are in separate regions
3. US3 follows US1; Polish follows both

---

## Notes

- This is a **breaking change** for any deployment relying on the permissive defaults. Per the
  project's stance it ships as one atomic change set rather than behind a flag; the notice
  lives in `deploy/.env.example` (T033) and `docs/domain/platform.md` (T034)
- The three `cmd/server.go` dev-only warnings are **deleted**, not supplemented (T017, T025)
- `/metrics` runs on a separate `http.Server` on `METRICS_PORT` that never passes through
  `withCORS`, so T016 cannot affect it
- Requests with no `Origin` header pass through `rs/cors` untouched, so native mobile,
  `/healthz` and server-to-server calls are unaffected by T016 (FR-021)
- Commit after each task or logical group; stop at any checkpoint to validate a story
