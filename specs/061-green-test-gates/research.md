# Phase 0 Research: Green and Enforced Test Gates

**Feature**: 061-green-test-gates | **Date**: 2026-09-12 | **Measured at**: `a33070a`

This document resolves every unknown the Technical Context raised. Each entry records what
was *measured* (commands run, files read) rather than what the drift register claims, because
FR-001 and FR-002 exist precisely because the register's account of these failures is partly
stale.

> **Scope note.** FR-001 requires a *runtime* baseline of the web E2E suite on a clean tree.
> That measurement needs a live Postgres, backend and Metro/Playwright host and is therefore
> the first implementation task (T001), not a planning artifact. Everything below is static
> analysis — reading the specs, the harness configuration and the product code — which is
> what settles *which cause each fix should address*. Where static analysis cannot settle a
> cause, the entry says so and names the measurement that will.

---

## R1 — Why `make test-frontend` cannot even start today (blocks FR-003)

**Decision**: Delete the `check-frontend` prerequisite from `test-frontend`,
`test-frontend-one`, `test-frontend-headed`, `test-frontend-ui` and
`test-frontend-screenshots`. Clears D71 by removing the guard rather than repairing it.

**Measured**:

- `Makefile:141` — `test-frontend: check-backend check-frontend`.
- `Makefile:64-69` — `check-frontend` is `curl -sf --max-time 3 $(FRONTEND_URL)`, i.e. the
  *root* route of the dev server on port 13000.
- `frontend/apps/web/e2e/playwright.config.ts:24-29` — the Playwright config declares its own
  `webServer`: `pnpm exec next dev --hostname 127.0.0.1 --port 3100`, with
  `reuseExistingServer: false` and a readiness probe on `${e2eBaseUrl}/signin/`.

**Rationale**: The suite has not used the port-13000 dev server since the config grew a
`webServer` block. Playwright starts its own server, on its own port, and already waits for
`/signin/` — a route the app actually serves. The guard therefore checks a server the suite
does not use, against a route (`/`) that answers 404 with Next's
`missing required error components` placeholder, and aborts the target before Playwright is
invoked. The check is not merely broken, it is redundant: deleting it is both the smallest
diff and the correct one.

**Alternatives considered**:

- *Probe `/signin/` instead of `/`* (what D71 suggests). Rejected: it would make the guard
  pass, but it would still be gating on a server the suite neither uses nor needs, so a
  developer with no dev server running would still be refused a suite that would have worked.
- *Accept any HTTP response (`curl -s -o /dev/null -w '%{http_code}'`)*. Same objection, plus
  it weakens the check to the point of asserting nothing.

`check-frontend` itself is left in place — `check-servers` and the `test` aggregate target
still reference it, and it is a correct check for "is the dev server up" in those contexts.

---

## R2 — The Next dev server is the shared root cause behind several "load-dependent" specs

**Decision**: Change the Playwright `webServer` from `next dev` to a production build:
`pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port 3100`, with the
`webServer.timeout` raised to accommodate the build.

**Measured**:

- D54 in `docs/domain/README.md:79` names four specs that "fail under full-suite load and pass
  when run directly", and identifies the mechanism for the first of them: *"a cross-document
  navigation that catches the Next dev server mid-compile receives its 'missing required error
  components' placeholder instead of the page"*. It records that the other three were never
  investigated.
- D71 (`README.md:101`) independently observes the same placeholder on `/`, and explicitly
  calls it "the same Next dev-server artifact D54 already names".
- Two of D54's four — `legal-surface.spec.ts` *"they cannot proceed without acknowledging the
  terms"* and `user-guide-screenshots.spec.ts` *"sign-in screens"* — are exactly the two specs
  D41 blames on the terms version. Both navigate to routes (`/signup`, `/signin`) that a
  freshly started dev server compiles on demand.
- `frontend/apps/web/package.json:16` — `output: "standalone"` is set in `next.config.ts`, and
  Next 15.5.2 treats `next start` under that configuration as a **warning**, not an error:
  `node_modules/next/dist/server/next.js:215` logs
  `"next start" does not work with "output: standalone"` and then proceeds to
  `this.createServer(...)` unconditionally. `next start` is therefore usable.

**Rationale**: On-demand compilation is the defect. Every spec that navigates to a cold route
races the compiler, and the loser gets a 404 placeholder instead of a page — which is why the
same specs pass in isolation (few routes, warm cache) and fail in a full run (many routes,
cold ones reached late). A production build compiles every route before the first request, so
the race cannot occur at all. It also means the suite exercises the artefact that ships rather
than a dev-only one.

**Alternatives considered**:

- *A `globalSetup` that warms every route with a GET first.* Rejected: the app has dozens of
  dynamic routes, the list would need maintaining, and it does not help client-side
  navigations into routes nobody thought to warm. It treats the symptom.
- *Set `retries: 1` locally (currently `process.env.CI ? 2 : 0`).* Rejected outright: it makes
  a suite that cannot be trusted to say no even less able to. This feature exists to end that.
- *Leave `next dev` and fix each spec individually.* Rejected: four specs across three files
  share one cause; patching four call sites leaves every future cold-route navigation broken.

**Residual risk, and its fallback**: `next build` is stricter than `next dev` — a type error
or a build-time data-fetch failure that dev tolerates will fail the build. This is measured in
T002. If the build cannot be made green inside this feature's scope, the fallback is the
route-warming `globalSetup` above, recorded in the drift register with the build failure that
forced it. The fallback is explicitly *not* "add retries".

---

## R3 — `user-guide-screenshots.spec.ts` and the accepted-terms version (FR-006)

**Decision**: Confirmed as stated in the spec. `registerOwner()` must send
`acceptedTermsVersion: TERMS_VERSION`.

**Measured**:

- `frontend/apps/web/e2e/user-guide-screenshots.spec.ts:97-107` — the
  `RegisterOrganizationWithAdminPassword` body carries `companyName`, `subdomain`,
  `adminEmail`, `adminPassword`, `adminGivenName`, `adminFamilyName` and **no**
  `acceptedTermsVersion`.
- `frontend/apps/web/e2e/helpers/auth.ts:8,88` — the shared `createTestOrg()` helper *does*
  send `acceptedTermsVersion: TERMS_VERSION`. This spec does not use that helper; it has its
  own named-people seeding primitives.
- `frontend/packages/apis/src/legal.ts:12` — `TERMS_VERSION = '2026-08-27'`.
- `backend/internal/iam/connect_terms.go:23` — `CurrentTermsVersion = "2026-08-27"`.

**Rationale**: The two constants agree, so the failure is an omitted field rejected as an
empty string, not a version skew. Importing `TERMS_VERSION` from `apis` — as `helpers/auth.ts`
already does — keeps the fixture on the same constant Constitution VIII requires the stack to
share, rather than hard-coding a date that will rot.

---

## R4 — `legal-surface.spec.ts:59`: the register's stated cause is wrong (FR-002, FR-005)

**Decision**: D41's account of this spec is **incorrect and must be corrected before the fix**
(FR-002). The most likely cause is R2's dev-server placeholder; the fix is R2, and the
correction is recorded in the register.

**Measured**:

- `legal-surface.spec.ts:59` is `test('they cannot proceed without acknowledging the terms')`,
  inside `describe('when a person signs up')`. It is **signed out**: it navigates to `/signup`
  and fills the form. It creates no organization and calls no helper.
- The file's only `createTestOrg()` call is in a `beforeAll` at line 85, belonging to a
  *different* describe block (`'when a person is signed in'`), and that helper does send the
  terms version (see R3). D41's claim that this test "fails in setup" because
  `RegisterOrganizationWithAdminPassword` refuses the terms version cannot be true of line 59:
  line 59 has no setup and issues no RPC.
- D54 independently lists this exact test — by title — among the four that fail only under
  full-suite load, alongside a cold-route navigation to `/signup`.

**Rationale**: Two rows describe the same test with incompatible causes; the one that matches
the code is D54's. Correcting D41 first is what FR-002 is for, and it is what stops this fix
from being written against a superseded guess.

**What is still open**: whether the placeholder is the *whole* cause. A secondary candidate is
strict-mode ambiguity on `page.getByRole('checkbox')` (line 77) if the signup form ever grows a
second checkbox — it has exactly one today, so this is not currently a failure. T001's baseline
run settles it; if the spec still fails after R2, the real failure is captured and the fix
written against it.

---

## R5 — `context-rail.spec.ts:155` is wall-clock dependent (FR-004, FR-008)

**Decision**: Pin the fixture's events and due dates to a fixed hour of the **browser's local**
day rather than to `now + N hours` and `new Date().toISOString()`.

**Measured** (`context-rail.spec.ts:155-209`):

- Lines 156-160 build `inOneHour` … `inFourHours` from `Date.now()`. Both seeded events are
  created at those offsets.
- Line 196 asserts `workspace-context-rail-next-up` contains `'+ 1 more today'`.
- Lines 172-173 set due dates with `new Date(...).toISOString().slice(0, 10)` — a **UTC**
  calendar date — while the rail's "Work today" section reads the browser's local day.

**Rationale**: Two independent clock bugs in one test. After roughly 20:00 local, `inThreeHours`
and `inFourHours` land on *tomorrow*, so the second event is not "today" and `'+ 1 more today'`
cannot appear. Independently, on any machine whose UTC date differs from its local date at the
moment of the run, the `toISOString()` due date is the wrong local day, so
`'Owner due today review'` is filtered out of "Work today". Anchoring both to a fixed local
hour — e.g. events at 09:00 and 11:00 local today, due dates from local-calendar arithmetic —
removes both. Where the anchor would already be in the past relative to a "next up" assertion,
the fixture anchors to the *next* whole hour within the local day and the test asserts against
that, rather than against wall-clock offsets.

**Alternatives considered**:

- *Freeze the browser clock with `page.clock`.* Rejected for now: the backend writes these rows
  from its own clock, so freezing only the browser makes the two disagree — the exact defect
  FR-008 is about. It remains the right tool if a future test needs to assert *across* a
  boundary.
- *Skip the test outside working hours.* Rejected: a gate that declines to run is a gate that
  cannot say no.

---

## R6 — `ritual-ux-redesign.spec.ts:486`: one clock, not two (FR-008, clears D45)

**Decision**: `api.setStandardTaskDueToday` computes the target instant in the **test process's
local timezone** and passes it as a bound value, instead of asking Postgres for `CURRENT_DATE`.

**Measured**:

- `frontend/apps/web/e2e/helpers/api.ts:450-465` — the helper issues
  `UPDATE collaboration.task SET due_date = CURRENT_DATE + interval '6 hour' …` through
  `docker compose exec -T postgres psql`.
- D45 records the container's server timezone as `Etc/UTC` and the reading side as
  `TodayView.tsx:255`, computing "today" from the browser's local midnight.
- The test process (Node) and the browser (Chromium, launched by that process) share the host's
  local timezone; Postgres does not.

**Rationale**: Three clocks exist and only two of them agree. Moving the date computation into
Node puts the writer on the same clock as the reader, which is what FR-008 asks for. The
alternative — making `TodayView` compare in UTC — would change product behaviour to satisfy a
test, which FR-011 forbids: a person in Hanoi should see their own Tuesday, not London's.

**Note on D45's stated direction.** D45 says the disagreement runs "from 17:00 local until
midnight" on a UTC+7 machine, but then reports the reproduction "in isolation at 04:00 local
(UTC 21:00 the previous day)" — which is the *other* end of the day. Working it through: on
UTC+7 the UTC and local calendar dates diverge between local 00:00 and 07:00, not between 17:00
and midnight; the 17:00-to-midnight window is what a UTC-*behind* machine sees. The row's
reproduction is right and its summary sentence is wrong. The defect and the fix are unaffected
— the two clocks disagree for part of every day on any machine whose offset is non-zero — but
the row is corrected when it is cleared, and the spec's Independent Test for User Story 1
("timezone ahead of UTC, after 17:00 local") is accordingly widened to "on a machine whose
local date differs from its UTC date", which is the property that actually matters.

[ASSUMPTION: The Independent Test in User Story 1 is satisfied by running the suite with `TZ`
set so that the local and UTC calendar dates differ at the moment of the run — e.g.
`TZ=Pacific/Kiritimati` (UTC+14) in the afternoon, or `TZ=Pacific/Midway` (UTC-11) in the
morning — rather than by waiting for a particular hour to arrive. This is faster, repeatable,
and tests the same property. The verification step sets `TZ` explicitly and records which
offset was used.]

---

## R7 — `ritual-ux-redesign.spec.ts`'s negative route assertion (FR-009, clears D42)

**Decision**: Replace the string-built pattern with a regex literal.

**Measured** (`ritual-ux-redesign.spec.ts:671`):

```ts
await expect(page).not.toHaveURL(new RegExp('/workspace/tasks/.+\?view=review'));
```

In a single-quoted JavaScript string `\?` is an unrecognised escape and collapses to `?`, so
the string handed to `RegExp` is `/workspace/tasks/.+?view=review`. The `?` binds to the
preceding `+` as a laziness modifier; the query separator the author meant to escape is gone.
The compiled pattern matches a URL that reaches `view=review` by *any* path — a hash fragment,
a second path segment — not only by a query string.

**Rationale**: `expect(page).not.toHaveURL(/\/workspace\/tasks\/.+\?view=review/)` says what it
means, needs no escaping-of-escaping, and cannot drift again. A regex literal is also what
line 433's sibling assertion should stay consistent with; that one builds its pattern from a
`projectId` template and is left as `new RegExp` with the interpolation, since it has a real
reason to be dynamic.

**Note**: D42 attributes the assertion to the test *"if a board is available it is not the
default route"* (line 406). The pattern is actually at line 671, in
*"alert-driven review entry highlights the pending submission instead of a backlog queue"*.
The row's diagnosis is exactly right and its location is wrong; corrected when cleared.

---

## R8 — `ritual-ux-redesign.spec.ts:375` "fails only under full-suite load" (FR-007)

**Decision**: The stated mechanism — parallel workers sharing state — **cannot be the cause**.
Re-measure under R2's production-build harness before writing a fix.

**Measured** (`frontend/apps/web/e2e/playwright.config.ts:8-9`):

```ts
fullyParallel: false,
workers: 1,
```

The suite runs one worker, serially. There are no parallel workers to share state between, so
D41's "fails only under full-suite load" describes *serial* ordering or accumulated
server-side state, not concurrency. The spec's Edge Case narrative ("shared state between
parallel workers", "the suite running at its normal concurrency") and Acceptance Scenario 4
("alongside the rest of the suite rather than in isolation") are written against a concurrency
model the harness does not have.

Line 375 sits in *"Today Review Health Calendar and Worklist are exposed as distinct ritual
surfaces"* (test begins line 363), in the assertion block that opens the Review tab and expects
`project-review-queue-link` to be visible. Its `beforeAll` (lines 316-360) submits evidence and
then polls `waitForRitualTaskState` for `pendingReviewCount > 0`, i.e. it depends on the ritual
reconciliation sweep having run.

**Leading hypothesis**: a background-job timing dependency. Under a long serial run the
reconciliation and review-queue sweeps are contending with every other spec's fixtures, so a
poll that succeeds quickly in isolation can exceed its budget late in a full run. If the
baseline confirms it, the fix is to widen or re-target the poll so it waits for the state the
assertion actually needs, not to run the spec alone.

**Rationale for re-measuring rather than fixing now**: FR-002 forbids fixing against a cause
the measurement does not support, and the one cause the register states is provably not
available in this harness. R2 also changes the harness materially; a baseline taken before it
would be re-measured anyway.

[ASSUMPTION: Acceptance Scenario 4 and the first Edge Case are read as "the spec passes when
run as part of the full suite, in suite order, rather than alone" — dropping the word
"concurrency", which does not describe this harness. The behavioural requirement (FR-007) is
unchanged and is verified the same way: a full `make test-frontend` run.]

---

## R9 — Suite re-runnability without a database reset (FR-010)

**Decision**: No new mechanism. Verify by running the suite twice and fix whatever the second
run surfaces.

**Measured**:

- `helpers/auth.ts` `createTestOrg()` generates a random subdomain per organization, so the
  specs that use it are re-runnable by construction.
- `user-guide-screenshots.spec.ts` is the one spec with a **fixed** address
  (`SUBDOMAIN = 'brightbean'`), and it already handles this: `purgePreviousSeed()`
  (lines 71-92) deletes the previous organization — including the 21 non-cascading child
  tables and the global `iam."user"` row that would otherwise collide on email — before
  seeding. That is exactly what Acceptance Scenario 2 asks for.
- `make test-db-purge` exists as the operator-facing cleanup and is not on the suite's path.

**Rationale**: The re-runnability requirement appears to be already satisfied; FR-010 is
therefore a verification requirement rather than a change. It is still verified explicitly,
because "appears to be satisfied" is the kind of claim this feature exists to stop accepting.

---

## R10 — Mobile static gate baseline (FR-027)

**Decision**: Green at `a33070a`. No mobile type errors to fix; the CI workflow is added
against a passing baseline, as FR-024 requires.

**Measured** — run in this session from `frontend/`:

```
$ pnpm run typecheck:mobile
> tsc -p apps/mobile/tsconfig.json --noEmit
(exit 0, 2.6s wall)

$ pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit --listFiles | grep -c apps/mobile
170
$ find apps/mobile -path ./node_modules -prune -o \( -name '*.ts' -o -name '*.tsx' \) -print | wc -l
175
```

170 of 175 sources are checked; the five omitted are the `src/**/*.check.ts` files the
tsconfig excludes deliberately. The gate is real, not vacuous, and it passes.

This confirms the spec's first Assumption and D34's own text: the three type errors were fixed
while making mobile dark mode's static gate real. Only enforcement is missing.

---

## R11 — What CI needs to reproduce the local check (FR-022, FR-025, FR-026)

**Decision**: One GitHub Actions workflow, `.github/workflows/checks.yml`, job `typecheck-mobile`,
on `pull_request` targeting `main` and `push` to `main`. Steps: checkout →
`pnpm/action-setup` → `actions/setup-node` with `cache: pnpm` →
`pnpm install --frozen-lockfile` in `frontend/` → `pnpm run typecheck:mobile`.

**Measured**:

- `.github/workflows/` contains only `publish-images.yml`. This is the repository's first
  quality-check workflow, as the spec's third Assumption states.
- `frontend/package.json` declares
  `packageManager: "pnpm@10.15.1+sha512.…"`, so `pnpm/action-setup` resolves the version from
  the manifest and no version needs pinning in the workflow.
- `frontend/pnpm-workspace.yaml` covers `packages/*` and `apps/*`; the lockfile is
  `frontend/pnpm-lock.yaml`. The install must therefore run with `frontend/` as its working
  directory.
- No package in the workspace declares a `postinstall` or `prepare` script, and
  `onlyBuiltDependencies` is not configured — so `pnpm install` runs no native build steps and
  needs no platform SDK.
- The `apis`, `rpc` and `@tech-office/links` workspace packages all set
  `"react-native": "index.ts"` (or `src/index.ts`) alongside a `dst/` build output that
  `.gitignore:18` excludes. `frontend/packages/rpc/rpc/v1/*_pb.ts` — the generated protobuf
  code — **is** tracked (`git ls-files` confirms). The typecheck resolves the workspace
  packages to their TypeScript sources: `--listFiles` shows 44 files from `packages/apis`, and
  the run above succeeded on a tree where `dst/` is stale or absent. No `pnpm build` step is
  needed, and no `buf generate` step is needed.
- No database, backend, device, emulator or browser is touched: `tsc --noEmit` reads files.
  FR-025 is satisfied by construction.

**Rationale**: Cheapest possible enforcement of a gate that already passes. The workflow runs
the *same command* the developer runs (`pnpm run typecheck:mobile` from `frontend/`), so a CI
pass and a local pass mean the same thing (FR-026), and `--frozen-lockfile` guarantees CI is
not silently resolving different dependency versions.

**Node version**: `actions/setup-node` with `node-version: 22`.

[ASSUMPTION: Node 22 (active LTS) is pinned in CI rather than the 23.10.0 this machine happens
to run. 23 is not an LTS line and is already out of support; Expo SDK targets 20/22. The
typecheck is a pure `tsc` run with `skipLibCheck: true`, so it is not sensitive to the runtime
version, and pinning the LTS is what a reviewer would expect. If a future check in this
workflow does become runtime-sensitive, the version moves to a `.nvmrc` both CI and developers
read.]

[ASSUMPTION: The workflow file is named `checks.yml` and its job `typecheck-mobile`, rather
than `typecheck-mobile.yml`, so that the backend, web E2E and lint gates the spec defers can
be added as further jobs in the same file without renaming anything. FR-024's "the workflow
must pass on the default branch" is satisfied for the single job that exists today.]

**FR-004's "skipped or fast enough"**: the job is ~3 s of `tsc` plus install. With
`cache: pnpm` a warm install is well under a minute, so the whole run finishes inside SC-005's
five-minute budget for every change, including backend-only and deploy-only ones. `paths-ignore`
filtering was considered and **rejected**: a required check that is skipped on some paths
reports as pending rather than passing, which blocks merges and is a well-known GitHub Actions
trap. Running an always-fast job unconditionally is simpler and cannot mis-report.

---

## R12 — How the Maestro fixture should be created (FR-012, FR-013)

**Decision**: A new `seed-maestro-fixture` command in `backend/cmd/seed_maestro.go`, registered
in `backend/cmd/main.go` alongside `SeedDemoOrgCommand`, modelled directly on it.

**Measured** (`backend/cmd/seed_demo.go`, 1028 lines):

- `SeedDemoOrgCommand` is a `urfave/cli/v3` command with `--subdomain`, `--owner-password`,
  `--spare-password` and `--worker-pin` flags, registered at `cmd/main.go:26`.
- Its idempotency pattern is `GetOrganizationBySubdomain` → reuse on `nil`, register on
  `pgx.ErrNoRows` (lines 137-165) — exactly what FR-013 asks for.
- It already solves every sub-problem this fixture needs:
  `RegisterOrganizationWithAdmin` with `AcceptedTermsVersion: iam.CurrentTermsVersion`
  (lines 147-160); `ensureDemoWorker` creating a PIN account via `iam.CreateOrgAccount` and
  then promoting the temporary PIN to permanent with `ActivateTemporaryCredential`
  (lines 231-322); `ensureDemoSpareOwner` hand-building a second email+password account and
  the invariant that `iam.identity.id`, `organization.employee.id` and `iam.user.id` must be
  the same UUID (lines 325-425); ritual definitions with a 720-hour completion window so the
  reconciliation sweep re-derives "overdue" rather than writing instances off as "missed"
  (`demoRitualCompletionWindowHours`, lines 76-81, 836-1001).
- `iam/logic_org_accounts.go:354` — `CreateOrgAccount` assigns `DefaultRoleEmployee`. The
  employee default role is therefore the "account without `iam.inviteUser`" FR-014 needs; no
  custom role has to be built.
- It runs against `database.NewAdminPool` with `config.Get()`, i.e. against `DATABASE_URL` —
  the same way a developer already runs the demo seed locally.

**Rationale**: The spec's fifth Assumption nominates this pattern and the measurement confirms
it is not just similar but nearly a superset. A shell script issuing RPCs would have to
re-solve permanent PINs, the same-UUID invariant and the ritual completion window from scratch,
in a language with no access to `iam.CurrentTermsVersion`.

**Alternatives considered**:

- *Extend `seed-demo-org` with a `--subdomain maestro` invocation.* Rejected: FR-019 forbids
  claiming the `demo` address, which a flag satisfies, but the *content* differs — the demo
  workspace is shaped for a store reviewer (two owners so deletion can be demonstrated), the
  Maestro fixture is shaped for 27 flows (a searchable word across four entity kinds, a team
  block with a specific overdue instance, colleagues with and without phone numbers). Merging
  the two would make each harder to read and would couple a store resubmission to a test-suite
  change.
- *Factor the shared helpers out of `seed_demo.go` first.* Rejected as premature: two callers
  is where a shared helper starts being worth extracting, but the overlap is mostly *pattern*
  rather than *code* — different content, different accounts, different emitted values. Shared
  extraction is revisited if a third seeder appears.

---

## R13 — Which `MAESTRO_*` values the standing suite actually reads (FR-015, FR-016, FR-017)

**Decision**: The seeder defines the thirteen values below. Everything else in `.env.example`
belongs to flows outside the standing suite and stays documented-but-unseeded.

**Measured** — every flow named in `frontend/apps/mobile/scripts/run-maestro-suite.sh` was
grepped for `MAESTRO_[A-Z_]*`:

| Variable | Read by | Fixture must provide |
|---|---|---|
| `MAESTRO_TEST_SUBDOMAIN` | `auth/signin.yaml`, `auth/signin-known-device.yaml` | the workspace address |
| `MAESTRO_TEST_EMAIL` | both sign-in flows, `projects/create-project.yaml`, `rituals/create-ritual.yaml` | primary account's email — used as a **password** login and as a **PIN** login identifier |
| `MAESTRO_TEST_PASSWORD` | `auth/signin.yaml` | primary account's password |
| `MAESTRO_TEST_PIN` | `auth/signin-known-device.yaml` | primary account's permanent PIN |
| `MAESTRO_OWNER_PASSWORD` | `onboarding/owner-signup.yaml` | a password the flow *types* to register a brand-new workspace — not an existing account |
| `MAESTRO_OWNER_PIN` | `onboarding/owner-signup.yaml` | likewise, typed not looked up |
| `MAESTRO_RUN_ID` | owner-signup, create-project, create-ritual, archive-ritual, report-message, report-thread-message | generated per run by the runner; **not** seeded |
| `MAESTRO_TEAM_TASK_ID` | `screens/today.yaml` | the task id of an overdue ritual instance assigned to *someone else* |
| `MAESTRO_SEARCH_WORD` | `federated-search.yaml` | one word matching a document, a work item, an event **and** a file |
| `MAESTRO_SEARCH_DOCUMENT_TITLE` | `federated-search.yaml` | that document's exact title |
| `MAESTRO_DIRECTORY_PERSON_WITH_PHONE` | `people/directory-call.yaml`, `compliance/block-from-profile.yaml` | family name of a colleague with a phone number |
| `MAESTRO_DIRECTORY_PERSON_NO_PHONE` | `people/directory-call.yaml` | family name of a colleague without one |
| `MAESTRO_DIRECTORY_DEPARTMENT` | `people/department-members.yaml` | a department with at least one member |

Additional findings the flows impose on the fixture:

- **`auth/signin.yaml` is the bootstrap of nearly every flow**, and it is the *email + password*
  path. `auth/signin-known-device.yaml` drives the *PIN* path with `MAESTRO_TEST_EMAIL` as the
  identifier (its own header note: "an account whose login identifier is `MAESTRO_TEST_EMAIL` —
  the identifier field accepts either an ID or a work email", which matches D17). The primary
  account therefore needs **both** a password credential and a permanent PIN credential.
- **`screens/today.yaml`** asserts `Nobody assigned` *and* taps
  `today-team-row-${MAESTRO_TEAM_TASK_ID}`, so the workspace needs **two** ritual instances in
  a project the primary account owns: one overdue and assigned to another person, one due today
  with no assignee.
- **`federated-search.yaml`** asserts `search-result-document`, `search-result-work_item`,
  `search-result-event` **and** `search-result-file` all appear for one word, then taps the
  document by title and expects it in "Recent" afterwards.
- **`compliance/delete-account.yaml`** deliberately stops at the confirmation and does **not**
  submit, so it does not consume an account; the fixture does not need a sacrificial one.
- **`onboarding/owner-signup.yaml`** creates its own workspace from the `MAESTRO_RUN_ID`-derived
  address. Each suite run leaves one behind. That is pre-existing behaviour, out of this
  feature's scope, and is recorded rather than changed.

**Rationale for stopping at the standing suite**: the spec's sixth Assumption. The nineteen
further values (`MAESTRO_CANONICAL_*`, `MAESTRO_NAV_*`, `MAESTRO_LINK_PREVIEW_*`) belong to
flows run individually against purpose-built fixtures. Seeding them is worth doing and is not
what makes `make test-mobile` runnable.

---

## R14 — The two feature-tour accounts (FR-014)

**Decision**: Seed a second **email + password** account holding the `employee` default role,
and emit its credentials as `MAESTRO_WORKER_EMAIL` / `MAESTRO_WORKER_PASSWORD`. Document in
`.env.example` and the quickstart that `feature-tour/worker-tour.yaml` is run by overriding
`MAESTRO_TEST_EMAIL` and `MAESTRO_TEST_PASSWORD` with them.

**Measured**:

- `feature-tour/owner-tour.yaml:5` — *"Requires `MAESTRO_TEST_EMAIL` to be an account holding
  `iam.inviteUser` — an owner or an operator"*; line 25 `runFlow: "../auth/signin.yaml"`.
- `feature-tour/worker-tour.yaml:51` — *"which also means `MAESTRO_TEST_EMAIL` must be an
  account WITHOUT `iam.inviteUser`"*; line 30 `runFlow: "../auth/signin.yaml"`.
- Both therefore read the *same* variable and need *different* accounts, and both authenticate
  through the email+password path — so the non-privileged account cannot be PIN-only.
- `iam/logic_org_accounts.go:354` — accounts created by `CreateOrgAccount` get
  `DefaultRoleEmployee`, which does not carry `iam.inviteUser`.

**Rationale**: The two flows are mutually exclusive on one variable; no single `.env` can
satisfy both, and neither flow is in the standing suite. Emitting a second, clearly named pair
and documenting the override is honest about that and costs one paragraph. Renaming the
variable inside the two flows was considered and rejected as out of scope — this feature does
not change flows it is not fixing.

**Open question for implementation**: whether the password login path accepts an org-managed
account (`is_org_managed = TRUE`). If it does, the worker is created with `CreateOrgAccount`
and given an additional password credential. If it does not, the worker is hand-built as a
self-registered account the way `ensureDemoSpareOwner` does (lines 325-425) and left on the
employee default role. Both land in the same place; the measurement decides which is fewer
lines. `MAESTRO_WORKER_LOGIN` / `MAESTRO_WORKER_PIN` are emitted either way, because a PIN
account is also what a realistic workspace contains.

---

## R15 — Failing fast on a missing fixture value (FR-018)

**Decision**: Extend the existing `check-maestro-env` Makefile target to assert the presence of
the thirteen standing-suite variables by name, in the same shape as the existing
`check-maestro-canonical-env` and `check-maestro-link-preview-env` targets, and have its error
name the seeding command.

**Measured** (`Makefile:238-278`):

- `check-maestro-env` today only asserts the *file exists*: `test -f $(MAESTRO_ENV)`.
- `check-maestro-canonical-env` and `check-maestro-link-preview-env` already implement exactly
  the required-variable loop, printing `✗ Missing … vars in <file>: <names>` and exiting 1.
- `test-mobile` already depends on `check-maestro-env` (`Makefile:290`), so the check runs
  before `run-maestro-suite.sh` launches a single flow.

**Rationale**: The pattern is in the file twice already; a third instance is the obvious move
and needs no new script. Reusing the loop means one message format across all three checks.
The only addition is naming the producing command in the failure text, which is the part FR-018
adds over the existing behaviour.

**Alternatives considered**: putting the check inside `run-maestro-suite.sh`. Rejected —
`make test-mobile-one` would then not get it, and the Makefile is where the other two live.

---

## R16 — Not colliding with the demo workspace (FR-019)

**Decision**: Default `--subdomain maestro`. Nothing in the fixture reads the `demo` workspace.

**Measured**: `seed_demo.go:44` defaults `--subdomain` to `demo`; the addresses are distinct and
`public.organization.subdomain` is unique, so the two seeds cannot merge. The Maestro seeder
creates its own project, ritual definition, department, colleagues, document, event and file,
so re-seeding `demo` cannot affect it.

---

## R17 — Recording what the restored suite actually does (FR-021, FR-031)

**Decision**: The suite is run once against the seeded fixture and the result recorded flow by
flow in the feature's completion notes; flows that fail for reasons outside this feature get a
drift row with their observed failure.

**Measured** — `run-maestro-suite.sh` names 27 flows (2 auth/onboarding, 6 `screens/*`,
`presence-ping-pong`, 8 `compliance/*`, 3 project/ritual, `federated-search`, 2 `people/*`,
2 `settings/*`), already reports `[pass]`/`[fail]` per flow and exits non-zero on any failure,
so no new reporting machinery is needed.

Known rows that will still be open afterwards and must say so plainly (FR-031): **D37** (Maestro
cannot drive a physical iPhone), **D18** (iOS AutoFill blocks the signup password field, which
makes `onboarding/owner-signup.yaml` unpassable on iOS), **D47** (deep links cold-start the dev
client), **D51** (three non-suite flows assert the old "Focus" screen title), **D67**
(`pnpm lint` fails with 184 errors and is not in CI).

**One further row the spec does not name, and it matters more than any of those.** **D77**
records that `auth/signin.yaml` — the bootstrap of nearly every flow — *intermittently loses the
text it types into `subdomain-input` on the iOS simulator*: the `eraseText`/`inputText` pair
races the IME, sign-in fails with "Subdomain is required" under a filled email field, and every
flow that runs the subflow fails with it. The row's own summary is the sharpest statement of this
feature's problem: *"It makes the mobile suite's pass/fail unreliable as a gate, which is worse
than a flow that simply fails."*

This is **not** a fixture problem and the seeder cannot touch it, so it is out of FR-012's scope.
But it bears directly on FR-020 and FR-021: a restored fixture makes the suite *startable*, and
D77 can still make its result untrustworthy. Two consequences follow, and both are planned rather
than discovered mid-run:

- Verification runs on **Android**, where D77 is not reported and where D18 does not block
  `owner-signup.yaml` either. That is the same platform D37 already forces for real hardware.
- D77 is added to the FR-031 list of rows that survive this feature and must say plainly that
  they remain open. Its closing note — wait on the field to report the typed value rather than on
  a fixed erase count — is a Maestro-flow change across the shared bootstrap, which is its own
  feature and would be the natural successor to this one.

[ASSUMPTION: D77 is recorded and left open rather than fixed here. The request named four things
— the web E2E specs, the Maestro fixture, mobile typecheck in CI, and the mobile type errors —
and rewriting the shared sign-in bootstrap's input handling is none of them. Leaving it open and
saying so is what FR-031 prescribes for exactly this case; fixing it silently would widen the
change set past what was asked for. It is flagged here because it is the largest remaining
obstacle to `make test-mobile` being a gate that can say no, which is this feature's stated goal,
and the next person should see it named rather than infer it.]

D51's text and `docs/domain/workspace-navigation.md:723-728` both need touching for FR-029: the
prose section is headed **"D47 — three older mobile flows still wait on a screen title that no
longer exists"** while the register calls that same problem **D51** and gives D47 to the
deep-link cold start. One of the two references is wrong and a reader following either lands in
the wrong place.

**Consequence for D18**: because `owner-signup.yaml` is the second flow in the standing suite
and cannot pass on iOS, "the suite runs" is demonstrated on Android (D37 already restricts iOS
to a simulator). This is stated in the quickstart rather than discovered at flow two.

---

## R18 — The drift register's ledger for this feature (FR-028, FR-029, FR-030)

**Decision and disposition**:

| Row | Disposition |
|---|---|
| **D34** | Removed once `.github/workflows/checks.yml` runs `typecheck:mobile` on PRs. Its type errors are already fixed (R10). |
| **D40** | Restored verbatim from `d4fefd1`'s deletion, then removed once the seeder makes the fixture reproducible. Restored first so the register's history is honest, per the spec's fourth Assumption. |
| **D41** | Corrected first (its `legal-surface` cause is wrong — R4; its `user-guide-screenshots` cause is right — R3), then removed once `make test-frontend` is observed green. |
| **D42** | Removed (R7), with its line number corrected in the change that clears it. |
| **D45** | Removed (R6), with its stated time-of-day window corrected. |
| **D54** | Removed if R2 clears all four; otherwise narrowed to whatever survives, with the measured failure. |
| **D71** | Removed (R1). |
| **D18, D37, D47, D51, D67, D77** | Left open, each restated to say plainly that it remains open and why (FR-031). D51's prose/register mislabelling is fixed (R17). D77 is added to this list by this plan — see R17 for why it is the one that most limits what a restored mobile suite proves. |
| **D57** | Added to the register's "Fixed on" list for the date feature 055 closed it. Its row was correctly removed when fixed but never listed, so `workspace-navigation.md:750`'s past-tense reference to it dangles. One line, and FR-029 needs it. |
| **D72** | Untouched and out of scope — `make check-tracked-files` is not one of the three gates this feature is about. |

**Measured**: the register's exact text for the deleted D40 row was recovered with
`git show d4fefd1 -- docs/domain/README.md`, so it is restored rather than paraphrased.

**Measured — the full set of dangling references.** A `D<number>` resolves if it is an open row
*or* is named in one of the register's "Fixed on …" lists; a naive grep flags every historical
mention and is useless. Run with that distinction (the exact commands are in
[quickstart.md](./quickstart.md) §4a), `a33070a` has exactly **two** dangling references: `D40`
and `D57`. Both are fixed by this feature. Twenty-two further numbers appear only inside the
"Fixed on" paragraphs and resolve correctly.

`docs/domain/platform.md`'s Testing section (lines 391-429) also carries three statements that
this work falsifies and FR-030 requires updating: that `make test-frontend` runs "two static
assertion checks" (the Makefile runs **three** — contrast, theme resolution and SSO
availability), that both frontend targets gate on `check-frontend` (R1 removes that), and that
`make test-frontend` "is not reliably green on a clean tree". It must also gain what CI
enforces and how the Maestro fixture is created.

---

## R19 — Nothing here is a product behaviour change (FR-011)

Every fix identified above lands in a test fixture, a test harness, a Makefile, a CI workflow,
a seeding command or a document. No change to `frontend/apps/web/src`, `frontend/apps/mobile/src`
or any backend service is planned. The one place the boundary is close is R6, where the
alternative fix would have been to change `TodayView`'s clock — rejected explicitly because it
would change what a user in a non-UTC timezone sees in order to make a test pass.

If T001's baseline turns up a failure whose cause is a genuine product bug, FR-011 and the
spec's eighth Assumption govern: fix it and say so explicitly, or record it in the register with
the spec left failing and say that plainly. It is not folded in silently, and no assertion is
weakened to make red go green.
