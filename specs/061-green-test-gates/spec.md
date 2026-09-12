# Feature Specification: Green and Enforced Test Gates

**Feature Branch**: `061-green-test-gates`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Green and enforced test gates. Fix the four failing web E2E specs, restore the Maestro fixture account, add mobile typecheck to CI, and fix the three mobile type errors. Constitution II names the suites as the correctness gate and today they cannot be trusted to say no. Clears drift D34, D40, D41."

## Why this exists

Constitution II says a feature is DONE only when the backend integration suite and the
web E2E suite both pass, and Constitution XIII says every mobile surface is covered by a
Maestro flow that runs on a device. Those three suites are the project's only mechanism
for saying *no* to a broken change.

Right now none of them can say no:

- `make test-frontend` does not pass on a clean tree, so a real regression is
  indistinguishable from the standing failures. Every feature since the failures appeared
  has had to tick a Constitution II box by arguing that the red was pre-existing.
- `make test-mobile` cannot start. The credentials in `frontend/apps/mobile/.maestro/.env`
  name a throwaway workspace that no longer exists on a local backend, and the shared
  `auth/signin.yaml` bootstrap every flow begins with fails on them. All 42 flows are
  unrunnable as configured.
- Nothing runs `tsc` on the mobile app anywhere except a human's terminal, which is how
  three type errors survived for several features before they were noticed.

The goal is not new coverage. It is restoring the ability of the existing suites to fail
honestly, and putting the cheap static gate somewhere that a person cannot forget to run.

### What was verified while writing this spec

The drift register's description of this problem is itself partly out of date, so the
current state was measured rather than trusted:

| Claim in the register | Measured state at `c2747b3` |
|---|---|
| D34: three mobile type errors | Already fixed. `pnpm run typecheck:mobile` exits 0. The only remaining D34 work is CI enforcement. |
| D34: no CI runs mobile `tsc` | Confirmed, and broader than stated — `.github/workflows/` contains only `publish-images.yml`. The repository has **no** test or static-check workflow of any kind. |
| D40 row in the drift register | **Missing.** The row was deleted from `docs/domain/README.md` in commit `d4fefd1` (feature 046) while D51 and `workspace-navigation.md` still refer to "D40". The register currently points at a row that is not there. |
| D41: `user-guide-screenshots.spec.ts` fails on the terms version | Confirmed, and the cause is located: `registerOwner()` in that spec omits `acceptedTermsVersion` entirely, and `ValidateAcceptedTermsVersion` rejects an empty string with `ErrStaleTermsVersion`. |
| D41: `legal-surface.spec.ts:59` fails on the terms version | **Doubtful.** `TERMS_VERSION` in `packages/apis/src/legal.ts` and `CurrentTermsVersion` in `backend/internal/iam/connect_terms.go` are both `2026-08-27`, `createTestOrg()` does send the field, and line 59 is a signed-out UI assertion with no org setup. This one needs re-diagnosis before it is fixed. |

That table is why FR-001 asks for a measured baseline first. Fixing a spec against a
stale description of why it fails is how the register got into this state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The web E2E suite passes on a clean tree (Priority: P1)

An engineer finishing a feature runs `make test-frontend` on a checkout with only their
own change applied. The suite either passes, or it fails and every failure it reports
belongs to their change. They do not have to consult a register of known-red specs to
decide whether their feature is done.

**Why this priority**: This is the gate Constitution II names most often, and it is the
one a feature hits on every single change. Until it is green, every other quality claim
in the project rests on a human remembering which failures to ignore.

**Independent Test**: Check out `main` with no other change, run `make test-frontend`
twice in a row, and confirm both runs exit 0. Then run it again from a machine whose
local timezone is ahead of UTC, in the evening, and confirm it still exits 0.

**Acceptance Scenarios**:

1. **Given** a checkout with no working-tree changes and a running local backend and
   frontend, **When** `make test-frontend` runs to completion, **Then** it exits 0 and
   reports zero failed specs.
2. **Given** the same checkout, **When** the full suite is run a second time without
   resetting the database, **Then** it exits 0 again — no spec depends on starting from
   an empty database or on being the first to claim a fixed workspace address.
3. **Given** a machine whose local timezone is UTC+7 and a wall clock reading 21:00 local,
   **When** the Today-view specs run, **Then** a task the fixture marked due today is
   shown as due today rather than filtered out as yesterday's.
4. **Given** the full suite running with its normal worker concurrency, **When**
   `ritual-ux-redesign.spec.ts` runs alongside the rest of the suite rather than in
   isolation, **Then** it passes — the spec no longer depends on being alone.
5. **Given** a spec whose assertion is a negative URL match, **When** that assertion is
   read by an engineer, **Then** the pattern it compiles to matches the pattern it appears
   to say, so the assertion can actually fail for the reason it claims to guard.

---

### User Story 2 - The Maestro suite can be started from a clean machine (Priority: P1)

An engineer with a connected device and a local backend runs one documented command to
create the fixture workspace, then runs `make test-mobile`. The suite signs in and runs.
They do not have to hand-build an organisation through the API and paste ids into a
`.env` file.

**Why this priority**: Constitution XIII requires a passing Maestro flow per mobile user
story. That requirement is currently unmeetable — not failing, but unrunnable — so mobile
features have been shipping with the box ticked on the strength of ad-hoc throwaway
organisations that nobody else can reproduce.

**Independent Test**: On a machine that has never run the suite, against a freshly
migrated empty database, run the seeding command and then `make test-mobile`, and confirm
the suite authenticates and begins executing flows.

**Acceptance Scenarios**:

1. **Given** a freshly migrated, empty local database, **When** the fixture seeding
   command runs, **Then** it creates the workspace, accounts and content the standing
   Maestro suite needs, and writes or prints every `MAESTRO_*` value those flows read.
2. **Given** a database that already holds the fixture workspace, **When** the seeding
   command runs a second time, **Then** it refreshes that workspace rather than creating a
   second one, and the values it emits are unchanged or correctly updated.
3. **Given** a seeded fixture, **When** `make test-mobile` runs, **Then**
   `auth/signin.yaml` authenticates successfully and the suite proceeds past its bootstrap
   into the flows themselves.
4. **Given** a seeded fixture, **When** the suite reaches a flow that needs a role
   distinction — an owner or operator for `feature-tour/owner-tour.yaml`, an account
   without `iam.inviteUser` for `feature-tour/worker-tour.yaml` — **Then** an account with
   each of those shapes exists and its credentials are among the emitted values.
5. **Given** the fixture `.env` is missing or incomplete, **When** `make test-mobile`
   runs, **Then** it stops with a message naming the missing values and the command that
   produces them, rather than failing several flows in on a confusing assertion.

---

### User Story 3 - The mobile static gate runs without being asked (Priority: P1)

An engineer opens a pull request that introduces a mobile type error. Continuous
integration fails on it before a reviewer looks at the diff. Nobody has to remember to run
`pnpm run typecheck:mobile`.

**Why this priority**: The gate already exists and already passes; what is missing is
enforcement. It is the cheapest of the three gates to automate — no device, no database,
no browser — and its absence is the documented cause of the last batch of type errors.

**Independent Test**: Push a branch containing a deliberate mobile type error and confirm
the CI run fails and names the error. Revert it and confirm the run passes.

**Acceptance Scenarios**:

1. **Given** a pull request against the default branch, **When** CI runs, **Then** the
   mobile TypeScript check runs as a required part of that run.
2. **Given** a branch containing a mobile type error, **When** CI runs, **Then** the run
   fails and its output names the file, line and error.
3. **Given** the default branch as it stands today, **When** CI runs, **Then** the mobile
   TypeScript check passes.
4. **Given** a change that touches only backend Go files or deployment configuration,
   **When** CI runs, **Then** the mobile check is skipped or completes quickly enough that
   it does not become a reason to bypass CI.

---

### User Story 4 - The drift register describes the repository that exists (Priority: P2)

Someone reading `docs/domain/README.md` to find out what is broken gets an accurate
answer. Rows that were fixed are gone, rows that are referenced exist, and rows that
remain describe the current cause rather than a superseded guess.

**Why this priority**: Lower than the three gates because it does not itself stop a
regression — but the register is what every feature since D41 appeared has used to justify
a red suite, and it is currently wrong in at least three places (D34's type errors are
fixed, D40's row was deleted while still referenced, D41's account of `legal-surface`
does not match the code). A register nobody can trust is worse than no register.

**Independent Test**: Grep the domain docs for every `D<number>` reference and confirm
each one resolves to a row that exists in the register's table.

**Acceptance Scenarios**:

1. **Given** the drift register after this work, **When** a reader looks for D34, D40 and
   D41, **Then** each is either gone because the problem is fixed, or present and
   describing the problem as it actually is.
2. **Given** the domain documents after this work, **When** any `D<number>` reference is
   followed, **Then** it resolves to a row that exists.
3. **Given** a drift row that survives this work because it was deliberately left out of
   scope, **When** it is read, **Then** it says so and says why.

---

### Edge Cases

- **A spec fails only under full-suite load.** `ritual-ux-redesign.spec.ts:375` passes in
  isolation and fails under concurrency. Making it pass by running it in isolation would
  leave the real defect — shared state between parallel workers — in place, so the fix has
  to survive the suite running at its normal concurrency.
- **A spec fails only at certain times of day.** `ritual-ux-redesign.spec.ts:486` fails
  wherever local time is ahead of UTC, between 17:00 local and midnight, because the
  fixture writes a due date in the database's UTC clock and the view reads it against the
  browser's local midnight. A fix verified at 09:00 has not been verified.
- **The seeded fixture and the demo workspace collide.** `seed-demo-org` already exists and
  claims the `demo` subdomain. The Maestro fixture must not claim the same address, must
  not depend on the demo workspace's content, and must survive the demo workspace being
  re-seeded.
- **The fixture workspace drifts from the flows.** New flows added later will need new
  fixture values. The failure mode when a value is missing must be a named error from the
  runner, not an assertion failure several flows in.
- **CI has no local backend.** The mobile TypeScript check needs no backend, database or
  device. If a check added here turns out to need one, it does not belong in this change.
- **A drift row is cleared on paper but not in fact.** Marking D41 cleared while a spec
  still fails would reproduce exactly the problem this feature exists to end. A row is
  removed only when the command it describes has been observed to pass.

## Requirements *(mandatory)*

### Functional Requirements

**Measuring the baseline**

- **FR-001**: The current failure set MUST be measured on a clean tree before anything is
  fixed, and recorded: for each failing web E2E spec, its file, its test title, and the
  observed failure. This baseline is what "green" is later checked against, and it is what
  settles whether each drift row's stated cause is still accurate.
- **FR-002**: Any drift row whose recorded cause does not match the measured failure MUST
  be corrected before the fix is written, so the fix addresses the real cause.

**The web E2E suite**

- **FR-003**: `make test-frontend` MUST exit 0 on a checkout with no working-tree changes,
  against a local backend and a local frontend.
- **FR-004**: `context-rail.spec.ts`'s calendar-route live-global-blocks test MUST pass.
- **FR-005**: `legal-surface.spec.ts` MUST pass in full.
- **FR-006**: `user-guide-screenshots.spec.ts` MUST pass in full. Its organisation
  registration MUST send the current accepted-terms version, which it does not today.
- **FR-007**: `ritual-ux-redesign.spec.ts` MUST pass when run as part of the full suite at
  its normal worker concurrency, not only in isolation.
- **FR-008**: The Today-view assertions MUST pass regardless of the host machine's
  timezone and time of day. The fixture that writes a due date and the view that reads it
  MUST agree on one clock.
- **FR-009**: `ritual-ux-redesign.spec.ts`'s negative route assertion MUST compile to the
  pattern it appears to express, so it can fail for the reason it claims to guard.
- **FR-010**: The suite MUST pass on a second consecutive run without the database being
  reset between runs.
- **FR-011**: No spec MUST be made to pass by weakening or deleting the behaviour it
  asserts. Where an assertion is genuinely wrong about the product, the correction MUST be
  stated explicitly in the change, not folded in silently.

**The Maestro fixture**

- **FR-012**: A single documented command MUST create the fixture workspace the standing
  Maestro suite signs into, on a freshly migrated database, with no manual API calls.
- **FR-013**: That command MUST be idempotent: a second run refreshes the existing fixture
  rather than creating a duplicate workspace.
- **FR-014**: The fixture MUST include an account with owner or operator authority and an
  account that lacks `iam.inviteUser`, because the two feature-tour flows distinguish
  between them.
- **FR-015**: The fixture MUST include the workspace content the standing suite's flows
  read from `.env` — at minimum the search word and document title, the team block's
  overdue and unassigned ritual instances, and the directory colleagues with and without a
  recorded phone number.
- **FR-016**: The command MUST emit every `MAESTRO_*` value its fixture defines, in a form
  that can be written directly to `frontend/apps/mobile/.maestro/.env`.
- **FR-017**: `frontend/apps/mobile/.maestro/.env.example` MUST document every variable
  the standing suite reads, and MUST name the seeding command as the way to produce them.
- **FR-018**: The Maestro runner MUST stop with a message naming any missing required
  value and the command that produces it, before it launches the first flow.
- **FR-019**: The fixture MUST NOT claim the `demo` workspace address used by
  `seed-demo-org`, and MUST NOT depend on that workspace's content.
- **FR-020**: `make test-mobile` MUST authenticate and proceed into its flows against a
  freshly seeded fixture. Individual flow results are reported in FR-021 rather than
  required here.
- **FR-021**: The result of running the standing suite against the restored fixture MUST
  be recorded flow by flow. Flows that fail for reasons outside this feature's scope MUST
  be written into the drift register with their observed failure, rather than left
  undescribed.

**Continuous integration**

- **FR-022**: A continuous-integration workflow MUST run `pnpm run typecheck:mobile` on
  every pull request targeting the default branch and on every push to it.
- **FR-023**: That workflow MUST fail the run when the check fails, and its output MUST
  name the offending file, line and error.
- **FR-024**: The workflow MUST pass on the default branch as it stands, with no source
  changes needed to make it pass.
- **FR-025**: The workflow MUST NOT require a database, a backend, a device or a browser.
- **FR-026**: The workflow MUST install dependencies the way the repository already does
  locally, so a CI pass and a local pass mean the same thing.

**Mobile type errors**

- **FR-027**: `pnpm run typecheck:mobile` MUST exit 0 on the default branch. This is
  already true as measured; the requirement stands so that the CI workflow added by
  FR-022 is verified against a passing baseline rather than being merged red. If the
  measurement in FR-001 finds any mobile type error, it MUST be fixed here.

**Documentation**

- **FR-028**: The drift register MUST have D34 removed once the mobile check runs in CI,
  D40 restored as a row and then removed once the fixture is seedable, and D41 removed
  once `make test-frontend` passes on a clean tree.
- **FR-029**: Every `D<number>` reference in `docs/domain/` MUST resolve to a row that
  exists in the register.
- **FR-030**: `docs/domain/platform.md` MUST describe the restored state: which commands
  constitute the gates, which of them CI enforces, and how the Maestro fixture is created.
- **FR-031**: Drift rows related to these suites that this feature does not clear — D37
  (Maestro cannot drive a physical iPhone), D18 (iOS AutoFill blocks owner signup), D47
  (deep links cold-start the dev client), D51 (three flows assert a renamed screen title),
  D67 (`pnpm lint` fails with 184 errors and is not in CI) — MUST be left in place and
  MUST each state plainly that they remain open and why.

### Key Entities

- **Web E2E suite**: the Playwright specs under `frontend/apps/web/e2e/`, invoked by
  `make test-frontend`. The gate Constitution II names for UI behaviour.
- **Maestro standing suite**: the ordered list of flows in
  `frontend/apps/mobile/scripts/run-maestro-suite.sh`, invoked by `make test-mobile`. A
  named subset of the 42 flow files; flows outside it are run individually.
- **Maestro fixture**: the workspace, accounts and content the standing suite signs into,
  together with the `MAESTRO_*` values that name them. Currently a hand-built throwaway
  organisation; this feature makes it a command.
- **Mobile static gate**: `pnpm run typecheck:mobile`. Passes today, enforced nowhere.
- **Drift register**: the table in `docs/domain/README.md`. The record of what is known to
  be broken, and the thing every recent feature has leaned on to justify a red suite.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `make test-frontend` exits 0 on a clean checkout, on two consecutive runs
  without a database reset, on a machine whose timezone is ahead of UTC, run after 17:00
  local.
- **SC-002**: The number of web E2E specs a person must know to ignore drops from four to
  zero. A reviewer can read a red suite as a real regression without consulting any list.
- **SC-003**: Going from a freshly migrated empty database to a Maestro suite that
  authenticates takes one documented command and no manual API calls.
- **SC-004**: Running the fixture command twice in a row leaves exactly one fixture
  workspace, and the second run's emitted values work as well as the first's.
- **SC-005**: A pull request introducing a mobile type error is failed by automation
  before a human reviews it, in under five minutes from push.
- **SC-006**: Every `D<number>` reference in `docs/domain/` resolves to a row that exists.
- **SC-007**: A feature completed after this work can state Constitution II compliance by
  citing a passing run, with no "pre-existing failure" caveat attached to the web E2E
  suite.

## Assumptions

- [ASSUMPTION: The three mobile type errors named in the request are already fixed —
  `pnpm run typecheck:mobile` exits 0 at `c2747b3`, which matches D34's own text. FR-027
  therefore requires the gate to be verified green rather than requiring three fixes that
  no longer exist. If the FR-001 baseline finds any mobile type error, it is fixed here.]
- [ASSUMPTION: "The four failing web E2E specs" means D41's list: `context-rail.spec.ts`'s
  calendar-route test, `legal-surface.spec.ts`, `user-guide-screenshots.spec.ts`, and
  `ritual-ux-redesign.spec.ts:375` which fails only under full-suite load. D45
  (`ritual-ux-redesign.spec.ts:486` failing part of every day on a UTC-ahead machine) and
  D42 (an assertion looser than it reads in the same file) are pulled in as FR-008 and
  FR-009 because the stated goal is a suite that can be trusted to say no, and a suite
  that fails after 17:00 or carries an assertion that cannot fire does not meet it. They
  are in the same file as the other two ritual fixes, so the cost of including them is
  small.]
- [ASSUMPTION: "Add mobile typecheck to CI" means creating the repository's first
  quality-check workflow — `.github/workflows/` currently holds only `publish-images.yml`.
  Only the mobile TypeScript check is added. Running the web E2E suite, the Go integration
  suite, or `pnpm lint` in CI is deliberately excluded: each needs a database, a backend
  or a browser, or is itself red (D67, 184 lint errors), and the request named the mobile
  check specifically. Wiring the heavier gates in is a separate feature with its own cost
  in runner time.]
- [ASSUMPTION: D40's drift row was deleted from the register in commit `d4fefd1` by
  accident rather than because the problem was fixed — the problem it describes is still
  present, and D51 and `workspace-navigation.md` still refer to it. It is restored and
  then cleared properly, so the register's history is honest about it.]
- [ASSUMPTION: The Maestro fixture is seeded by a backend command in the style of the
  existing `seed-demo-org` in `backend/cmd/seed_demo.go` — idempotent, flag-configurable,
  and run against the local database — rather than by a shell script making RPC calls.
  That command already solves the same problem for store review, so the pattern is proven
  here and needs no new infrastructure. The exact command shape is a planning decision.]
- [ASSUMPTION: The fixture covers the flows in the standing suite, not all 42 flow files.
  Flows outside the suite (the canonical-link, navigation, ritual and chat-link-preview
  flows) read a further nineteen `MAESTRO_*` values and are run individually against
  purpose-built fixtures. Extending the seeder to cover them is worth doing but is not
  what makes `make test-mobile` runnable, so it is left for a later change and recorded in
  the register.]
- [ASSUMPTION: D37 stands — Maestro still cannot drive a physical iPhone, so "the suite
  runs" means on a real Android device or an iOS simulator. This feature does not attempt
  to fix the iOS driver.]
- [ASSUMPTION: Where a spec's assertion turns out to be wrong about the product rather
  than the product being wrong, the assertion is corrected and the correction is called
  out. This feature does not change product behaviour to satisfy a test; if a test failure
  turns out to be a genuine product bug, that bug is fixed or, if it is out of proportion
  to this feature, recorded in the register with the spec left failing and said so
  plainly rather than quietly skipped.]
- [ASSUMPTION: CI runs on GitHub Actions, matching the existing `publish-images.yml`, on
  the free `ubuntu-latest` runner. The repository is public, so the runner minutes are
  free and no budget decision is needed.]
