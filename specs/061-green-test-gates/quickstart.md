# Quickstart: verifying the restored gates

**Feature**: 061-green-test-gates | **Plan**: [plan.md](./plan.md)

This is the validation guide. Every scenario below is a runnable check that proves one of the
feature's Success Criteria. Implementation detail belongs in `tasks.md`; this file is what you
run to decide whether the work is done.

---

## Prerequisites

| For | You need |
|---|---|
| Web E2E | Postgres and the backend up — `make check-postgres check-backend`. Playwright starts its own web server, so no dev server on 13000 is required (that is the point of the D71 fix). |
| Maestro | A connected **Android** device or emulator, Metro on 18082, the backend on 18080, Maestro 2.3.0 installed. |
| CI | A GitHub remote and permission to push a branch. |
| Mobile typecheck | `pnpm install` in `frontend/`. Nothing else. |

Use the repository's supported tooling — `Makefile` targets and `backend/docker-compose.yml` —
rather than improvising a local setup.

> **Which platform for Maestro.** Android. **D37** stands: Maestro 2.3.0 cannot enumerate a
> physical iPhone, and the newer releases fail to build their XCUITest driver, so iOS is
> simulator-only. **D18** stands too: iOS 18's AutoFill cover view sits over the mobile signup
> password field, so `onboarding/owner-signup.yaml` — the *second* flow in the standing suite —
> cannot pass on iOS at all. Verifying "the suite runs" on an iOS simulator would therefore stop
> at flow two for a reason unrelated to this feature.

---

## Scenario 1 — The web E2E suite passes on a clean tree (US1, SC-001, SC-002)

**Before the fix**, capture the baseline. This is FR-001, and it is a deliverable, not a warm-up:

```bash
cd frontend
pnpm --filter web exec playwright test --config=e2e/playwright.config.ts 2>&1 | tee /tmp/e2e-baseline.txt
```

Invoked directly rather than through `make test-frontend`, because the `check-frontend` guard
aborts the target before Playwright runs (D71) — that is the state being measured.

Record, for each failure: **file, test title, observed error**. Then reconcile against D41, D42,
D45 and D54 in `docs/domain/README.md` and correct any row the run contradicts, **before** its
fix is written (FR-002). Research [R4](./research.md), [R7](./research.md) and
[R8](./research.md) already show three rows whose stated cause the code does not support.

**After the fix**, the gate itself:

```bash
make test-frontend            # exits 0
echo $?                       # 0
```

Expected: the target now starts (no `check-frontend` abort), Playwright builds the web app once,
and every spec passes. Zero failed specs.

### 1a — Twice in a row, no database reset (FR-010, Acceptance Scenario 2)

```bash
make test-frontend && make test-frontend
```

Both runs exit 0. Nothing between them. `user-guide-screenshots.spec.ts` is the only spec on a
fixed workspace address and it purges its own previous seed, so this should hold — verify it
rather than assume it.

### 1b — On a machine whose calendar date differs from UTC's (FR-008, Acceptance Scenario 3)

```bash
TZ=Pacific/Kiritimati make test-frontend     # UTC+14 — run in the afternoon
# or
TZ=Pacific/Midway make test-frontend         # UTC-11 — run in the morning
```

Setting `TZ` is faster and repeatable where waiting for 21:00 local is neither, and it tests the
same property: the fixture's clock and the view's clock must agree. Record which offset was used.
Expected: exit 0. The specs this exercises are `ritual-ux-redesign.spec.ts` ("Today keeps
standard tasks and ritual runs in separate labeled sections") and `context-rail.spec.ts` ("the
rail renders live global blocks…").

### 1c — The assertion that could not fail (FR-009)

Read `ritual-ux-redesign.spec.ts`'s negative route assertion. The pattern it compiles to must be
the pattern it appears to say — an escaped query separator, not a lazy quantifier. Prove it in
one line rather than by eye:

```bash
node -e "console.log(new RegExp('/workspace/tasks/.+\?view=review').source)"
# before: /workspace/tasks/.+?view=review     ← the '?' modifies '+'
```

After the fix the assertion is a regex literal and the escape survives.

**Pass when**: `make test-frontend` exits 0 in all three runs above, and the number of specs a
person must know to ignore is zero (SC-002).

---

## Scenario 2 — The Maestro suite starts from a clean machine (US2, SC-003, SC-004)

### 2a — One command, from an empty database (FR-012, Acceptance Scenario 1)

```bash
# A freshly migrated, empty database
cd backend && ./scripts/migrate.sh

go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env
```

Expected: the workspace, accounts and content are created; stdout is a complete `.env` body and
nothing else; progress lines appear on stderr. No manual API call, no id pasted by hand.

See [contracts/seed-maestro-fixture.md](./contracts/seed-maestro-fixture.md) for the full flag
and output contract, and [data-model.md](./data-model.md) for what the fixture contains and why.

### 2b — Idempotent (FR-013, SC-004, Acceptance Scenario 2)

```bash
go run ./cmd seed-maestro-fixture > /tmp/seed-1.env
go run ./cmd seed-maestro-fixture > /tmp/seed-2.env
diff /tmp/seed-1.env /tmp/seed-2.env
```

Expected: exactly one organization at the `maestro` address —

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM public.organization WHERE subdomain = 'maestro';"
# 1
```

— and the two outputs differ only in the timestamp comment and `MAESTRO_TEAM_TASK_ID`, which
changes when the overdue ritual instance is recreated. Both emitted sets must work.

### 2c — It does not collide with the demo workspace (FR-019)

```bash
go run ./cmd seed-demo-org          # re-seed the store-review workspace
go run ./cmd seed-maestro-fixture   # still succeeds, values unchanged but the task id
go run ./cmd seed-maestro-fixture --subdomain demo    # must FAIL, naming FR-019
```

### 2d — The suite authenticates and runs (FR-020, Acceptance Scenario 3)

```bash
make test-mobile
```

Expected: `check-maestro-env` passes, `auth/signin-known-device.yaml` authenticates, and the
runner proceeds into the flows. The bar here is *the suite starts and gets past its bootstrap* —
individual flow outcomes are 2f.

### 2e — A missing value stops the run before the first flow (FR-018, Acceptance Scenario 5)

```bash
cp frontend/apps/mobile/.maestro/.env /tmp/env.bak
grep -v '^MAESTRO_TEAM_TASK_ID=' /tmp/env.bak > frontend/apps/mobile/.maestro/.env
make test-mobile
cp /tmp/env.bak frontend/apps/mobile/.maestro/.env
```

Expected: exits non-zero **before** launching a flow, naming `MAESTRO_TEAM_TASK_ID` and printing
the seeding command. Repeat with the value present but empty (`MAESTRO_TEAM_TASK_ID=`) — the
runner silently skips empty values, so an empty one must fail the check too.

### 2f — Record every flow (FR-021)

`run-maestro-suite.sh` already prints `[pass]`/`[fail]` per flow and a failure count.

```bash
make test-mobile 2>&1 | tee /tmp/maestro-run.txt
grep -E '^\[(pass|fail)\]' /tmp/maestro-run.txt
```

Record the result of all 27 flows. Any flow that fails for a reason outside this feature's scope
gets a **drift row with its observed failure** — not silence, and not a cleared D40.

### 2g — Both feature-tour account shapes exist (FR-014)

The two tours read the same variable and need different accounts, so each is run with an
override:

```bash
make test-mobile-one F=feature-tour/owner-tour     # MAESTRO_TEST_EMAIL as seeded: has iam.inviteUser
make test-mobile-one F=feature-tour/worker-tour \
  MAESTRO_ENV_FLAGS="-e MAESTRO_TEST_EMAIL=<MAESTRO_WORKER_EMAIL> -e MAESTRO_TEST_PASSWORD=<MAESTRO_WORKER_PASSWORD> ..."
```

The requirement is that **both account shapes exist in the fixture and their credentials are
emitted**. Neither tour is in the standing suite, so their pass/fail is recorded under 2f's rule
rather than gating this feature.

**Pass when**: an empty database reaches an authenticating Maestro suite in one documented
command (SC-003), and a second seed leaves one workspace (SC-004).

---

## Scenario 3 — The mobile static gate runs without being asked (US3, SC-005)

### 3a — Green baseline (FR-024, FR-027)

```bash
cd frontend && pnpm run typecheck:mobile
echo $?   # 0
```

Already measured green at `a33070a` — 170 of 175 mobile sources checked, 2.6 s.

### 3b — CI fails a real error (FR-023, US3 Independent Test)

Push a branch with a deliberate mobile type error, e.g. in a mobile screen:

```ts
const n: number = 'not a number';
```

Expected: the `typecheck-mobile` job fails and its log contains the **file, line and error code**:
`apps/mobile/src/....tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'.`

### 3c — CI passes when reverted

Revert the error, push. The job passes. **Both directions are required** — a gate verified only
in the passing direction is not verified.

### 3d — It stays fast (SC-005, US3 Acceptance Scenario 4)

Push a backend-only or deploy-only change. Expected: the job still runs (it is deliberately not
path-filtered — see [contracts/ci-typecheck-mobile.md](./contracts/ci-typecheck-mobile.md)) and
completes well under five minutes from push.

**Pass when**: a mobile type error is failed by automation before a human reviews the diff.

---

## Scenario 4 — The drift register describes the repository that exists (US4, SC-006)

### 4a — Every reference resolves (FR-029)

A `D<number>` in `docs/domain/` resolves if it is either an **open row** in the register's table
or named in one of the register's **"Fixed on …"** lists. A naive grep flags every historical
mention, so the check has to know about both:

```bash
cd /Volumes/T5/Codes/tech-office

# Rows that are open right now.
grep -oE '^\| D[0-9]{1,3} ' docs/domain/README.md | tr -d '| ' | sort -u > /tmp/rows.txt

# Rows recorded as fixed (the "### Fixed on <date>" paragraphs).
awk '/^### Fixed on/{f=1} /^\| D[0-9]/{f=0} f' docs/domain/README.md \
  | grep -ohE '\bD[0-9]{1,3}\b' | sort -u > /tmp/fixed.txt

cat /tmp/rows.txt /tmp/fixed.txt | sort -u > /tmp/resolvable.txt
grep -rhoE '\bD[0-9]{1,3}\b' docs/domain/ | sort -u > /tmp/refs.txt

comm -23 /tmp/refs.txt /tmp/resolvable.txt      # must print nothing
```

Expected: no output. **Run at `a33070a` this prints exactly two:**

- **`D40`** — its row was deleted in `d4fefd1` while the D51 row and
  `docs/domain/workspace-navigation.md:728` still point at it. Restored from the deleted text,
  then cleared properly once the fixture is seedable (FR-028).
- **`D57`** — `workspace-navigation.md:750` says "Recorded as **D57** in the drift register until
  feature 055 found the cause". The row was correctly removed when it was fixed, but never added
  to a "Fixed on" list, so the reference dangles. Add it to the list for the date it was fixed;
  a past-tense mention of a solved problem is worth keeping, and one line makes it resolve.

Also check the mislabelling a grep cannot catch: `workspace-navigation.md:723` heads its prose
section **"D47 — three older mobile flows still wait on a screen title…"** while the register
calls that problem **D51** and gives D47 to the deep-link cold start. A reader following either
reference lands on the wrong problem. One of the two is wrong and must be fixed.

### 4b — Rows are cleared only against an observed pass (FR-028)

Each of these must be true **before** its row is deleted — not after, and not on the strength of
a plan:

| Row | Cleared only when |
|---|---|
| D34 | the `typecheck-mobile` job has run and passed on a pull request |
| D40 | restored first from `d4fefd1`, then cleared once 2a–2d have been observed |
| D41 | `make test-frontend` has been observed to exit 0 (Scenario 1) |
| D42 | 1c shows the corrected pattern and the suite is green |
| D45 | 1b has been run under a shifted `TZ` and passed |
| D54 | the four specs it names have passed in a full run |
| D71 | `make test-frontend` starts without the guard aborting it |

### 4c — Rows that survive say so (FR-031)

`D18`, `D37`, `D47`, `D51`, `D67` and **`D77`** remain open. Each must state plainly that it is
still open and why. Read them and confirm none has been quietly softened to look cleared.

D77 is the one to read carefully: it records that `auth/signin.yaml` intermittently loses the
text it types into `subdomain-input` on the iOS simulator, which makes the mobile suite's
pass/fail unreliable rather than merely failing. A restored fixture makes the suite *startable*;
D77 is what still stands between that and a suite that can be trusted to say no on iOS. It is
out of this feature's scope (see [research.md](./research.md) R17) and must not be cleared here.

### 4d — `platform.md` describes the restored state (FR-030)

`docs/domain/platform.md`'s Testing section must say which commands are the gates, which of them
CI enforces, and how the Maestro fixture is created. Three current statements are falsified by
this work and must go: that `make test-frontend` runs "two static assertion checks" (the Makefile
runs three — contrast, theme resolution and SSO availability), that both frontend targets gate on
`check-frontend`, and that `make test-frontend` "is not reliably green on a clean tree".

**Pass when**: 4a prints nothing (SC-006), and no row is cleared without a run behind it.

---

## Regression gates before completion

These are the project's standing gates, not this feature's own, and they are run because this
feature touches the Makefile, a backend command and the CI surface:

```bash
make lint-tenancy      # expected green — no new SQL, no new query file
make test-backend      # expected green; D52 and D70 make it load-dependent
make test-frontend     # this feature's own deliverable — must be green
```

**If a gate is red, say so with its output.** A feature about making suites able to fail honestly
cannot be completed on a caveat.

**If `make test-backend` fails on D52's latency assertion or D70's search-threshold leak**, that
is the pre-existing load-dependence those rows describe; re-run the named test in isolation,
record the result, and leave the rows open. Neither is in this feature's scope, and neither may
be cleared here.
