# Phase 1 Data Model: Green and Enforced Test Gates

**Feature**: 061-green-test-gates | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

No database schema changes. No migration, no new table, no new column, no proto field. Every
entity below is either an existing row the fixture seeder *populates*, or a configuration
artifact that this feature defines the shape of.

The one genuinely new data structure in this feature is the **Maestro fixture** — a named set of
rows in existing tables, plus the set of `MAESTRO_*` values that address them.

---

## 1. Maestro fixture workspace

The workspace `seed-maestro-fixture` creates or refreshes. One organization, distinct from the
`demo` workspace `seed-demo-org` owns (FR-019).

| Field | Value | Source |
|---|---|---|
| `public.organization.subdomain` | `maestro` (overridable with `--subdomain`) | flag default |
| `public.organization.id` | assigned by `RegisterOrganizationWithAdmin` | UUID v7 |
| Company name | `Maestro Fixture` | constant |

**Identity rule**: the workspace is identified by its **subdomain**, which is unique in
`public.organization`. A second run resolves the existing row with
`GetOrganizationBySubdomain` and refreshes its contents; only `pgx.ErrNoRows` causes a
registration. This is `seed_demo.go:137-165`'s pattern and is what satisfies FR-013 and SC-004.

**Validation**: the subdomain MUST NOT be `demo`. The command rejects `--subdomain demo` with an
error naming FR-019, rather than silently colliding with the store-review workspace.

---

## 2. Accounts

Four accounts, each with a distinct reason to exist. Every one of them carries the invariant
`seed_demo.go:325-425` documents: `iam.identity.id`, `organization.employee.id` and
`iam.user.id` are the **same UUID**, because the JWT `sub` claim carries `iam.user.id` and every
org-scoped service reads it as an employee id.

### 2.1 Primary account — the one nearly every flow signs in as

| Property | Value | Why |
|---|---|---|
| Role | owner (self-registered, `is_org_managed = FALSE`) | Holds `iam.inviteUser` — required by `feature-tour/owner-tour.yaml`; owns the project `screens/today.yaml` reads its team block from |
| Email | `owner@<subdomain>.maestro.invalid` | → `MAESTRO_TEST_EMAIL` |
| Password credential | `--owner-password` | → `MAESTRO_TEST_PASSWORD`; used by `auth/signin.yaml`, the bootstrap of nearly every flow |
| PIN credential | `--owner-pin`, **permanent** | → `MAESTRO_TEST_PIN`; used by `auth/signin-known-device.yaml`, whose identifier field takes the email (D17) |
| Terms acceptance | `iam.CurrentTermsVersion` at seed time | otherwise the terms gate stands between sign-in and the app on the very first flow |

**This account needs two credentials.** That is the finding that most shapes the seeder:
`signin.yaml` is the email+password path and `signin-known-device.yaml` is the PIN path, and both
address the *same* account through `MAESTRO_TEST_EMAIL`. The PIN must be promoted past its
three-day temporary expiry with `ActivateTemporaryCredential`, the way
`ensureDemoWorker` (`seed_demo.go:231-322`) already does — a fixture that dies after three days
is not a fixture.

### 2.2 Worker account — the account *without* `iam.inviteUser`

| Property | Value | Why |
|---|---|---|
| Role | `DefaultRoleEmployee` | `iam/logic_org_accounts.go:354` assigns it; it does not carry `iam.inviteUser` (FR-014) |
| Email + password | `worker@<subdomain>.maestro.invalid`, `--worker-password` | → `MAESTRO_WORKER_EMAIL` / `MAESTRO_WORKER_PASSWORD`; `feature-tour/worker-tour.yaml` bootstraps through `auth/signin.yaml`, so a PIN-only account cannot serve it |
| Login identifier + PIN | `maestro-worker`, `--worker-pin`, permanent | → `MAESTRO_WORKER_LOGIN` / `MAESTRO_WORKER_PIN` |

The two feature-tour flows read the **same** variable (`MAESTRO_TEST_EMAIL`) and require
**different** accounts, so no single `.env` satisfies both. The worker's credentials are emitted
under their own names and the override is documented (research R14).

### 2.3 Colleague with a phone number

| Property | Value |
|---|---|
| Family name | `Tran` → `MAESTRO_DIRECTORY_PERSON_WITH_PHONE` |
| Given name | `Mai` |
| Phone | recorded, non-empty |
| Department | member of the seeded department |

Read by `people/directory-call.yaml` (searched by family name, expects a call affordance) and by
`compliance/block-from-profile.yaml` (opens this person's profile and blocks them).

**Idempotency note**: `compliance/block-person.yaml` and `block-from-profile.yaml` leave a block
behind. A re-seed clears blocks involving fixture accounts, so a second suite run starts from the
same state as the first — otherwise flow 2 of run 2 asserts against an already-blocked person.

### 2.4 Colleague without a phone number

| Property | Value |
|---|---|
| Family name | `Okafor` → `MAESTRO_DIRECTORY_PERSON_NO_PHONE` |
| Given name | `Sam` |
| Phone | absent |

`people/directory-call.yaml` searches for this person and expects the *absence* of the call
affordance. The distinction is the whole point of the flow, so the seeder must positively ensure
the field is empty on a re-seed, not merely decline to set it.

---

## 3. Department

| Field | Value |
|---|---|
| Name | `Store Floor` → `MAESTRO_DIRECTORY_DEPARTMENT` |
| Members | at least the two colleagues above |

`people/department-members.yaml` opens the department by name and expects a non-empty member
list.

---

## 4. Work content

### 4.1 Ritual project and definition

A project in `COLLABORATION_MODE_RITUAL`, **owned or administered by the primary account** —
`screens/today.yaml`'s team block only renders for someone who owns or administers a project.

The ritual definition carries a **720-hour completion window**, copied from
`demoRitualCompletionWindowHours` (`seed_demo.go:76-81`). The reason is recorded in spec 055's
research and holds identically here: with a short window the reconciliation sweep writes a late
instance off as `missed` — a closed state — which empties Today, My Work and the team block
within five minutes of the seed landing.

### 4.2 The two ritual instances the team block needs

| Instance | State | Assignee | Emitted as |
|---|---|---|---|
| Overdue | past its scheduled date, still open | the colleague with a phone (**not** the primary account) | `MAESTRO_TEAM_TASK_ID` |
| Due today | scheduled today | **none** | — (asserted by the text `Nobody assigned`) |

`screens/today.yaml` asserts `Nobody assigned` and then taps
`today-team-row-${MAESTRO_TEAM_TASK_ID}`, so both must exist and the overdue one must belong to
somebody else — a team block showing your own work is not a team block.

`MAESTRO_TEAM_TASK_ID` is the **task id** of the overdue instance, because that is what the row's
`testID` carries. It changes on every re-seed that recreates the instance, which is exactly why
the seeder emits it rather than a human transcribing it.

### 4.3 The federated-search set

`federated-search.yaml` asserts that one word returns **four** result kinds at once, then opens
the document by title.

| Entity | Carries the word | Emitted as |
|---|---|---|
| Document | in its title | title → `MAESTRO_SEARCH_DOCUMENT_TITLE` |
| Work item (task) | in its title | — |
| Calendar event | in its title | — |
| File | in its filename | — |

| Field | Value |
|---|---|
| Search word | `zarquon` → `MAESTRO_SEARCH_WORD` |
| Document title | `Zarquon Closing Procedure` |

The word is deliberately nonsense so it cannot collide with seeded prose elsewhere in the
workspace, and it matches what the current `.env.example` already documents — keeping the
example honest costs nothing here.

[ASSUMPTION: The file result is matched on **filename**, and the seeder therefore names the file
`zarquon-closing-procedure.pdf` rather than relying on extracted file *content*. Content
indexing is feature 059's subject and runs as post-processing, so a fixture that depended on it
would be seeding a race. If the baseline run shows `search-result-file` does not match on name,
the seeder additionally writes the indexed content row and the dependency is recorded.]

### 4.4 Chat

At least one channel with messages the primary account can see, because
`compliance/report-message.yaml`, `report-thread-message.yaml` and `screens/chat.yaml` all open
the chat tab and act on a message. These flows post what they act on (using `MAESTRO_RUN_ID`),
so the fixture needs the channel, not particular messages.

---

## 5. Emitted values — the `MAESTRO_*` contract

The full variable contract, its consumers and the fail-fast check live in
[contracts/maestro-env.md](./contracts/maestro-env.md). In summary, the seeder emits:

- **4 primary-account values** — `MAESTRO_TEST_SUBDOMAIN`, `MAESTRO_TEST_EMAIL`,
  `MAESTRO_TEST_PASSWORD`, `MAESTRO_TEST_PIN`
- **2 owner-signup values** — `MAESTRO_OWNER_PASSWORD`, `MAESTRO_OWNER_PIN` (these are *typed by*
  `onboarding/owner-signup.yaml` to register a brand-new workspace; they do not address a seeded
  account, and the seeder emits them only so one command produces a complete `.env`)
- **4 worker values** — `MAESTRO_WORKER_EMAIL`, `MAESTRO_WORKER_PASSWORD`,
  `MAESTRO_WORKER_LOGIN`, `MAESTRO_WORKER_PIN`
- **1 team-block value** — `MAESTRO_TEAM_TASK_ID`
- **2 search values** — `MAESTRO_SEARCH_WORD`, `MAESTRO_SEARCH_DOCUMENT_TITLE`
- **3 directory values** — `MAESTRO_DIRECTORY_PERSON_WITH_PHONE`,
  `MAESTRO_DIRECTORY_PERSON_NO_PHONE`, `MAESTRO_DIRECTORY_DEPARTMENT`

`MAESTRO_RUN_ID` is **not** emitted: `run-maestro-suite.sh` generates it per run from a
timestamp, and a value pinned in `.env` would make the second run of `owner-signup.yaml` collide
on the workspace address it derives.

`MAESTRO_CANONICAL_*`, `MAESTRO_NAV_*` and `MAESTRO_LINK_PREVIEW_*` are **not** emitted — they
belong to flows outside the standing suite (spec Assumption 6). `.env.example` keeps documenting
them, marked as belonging to individually-run flows.

---

## 6. State transitions

The fixture has exactly two states and one transition, which is what "idempotent" means here:

```
        ┌──────────────────────────────────────────────┐
        │                                              │
 (no maestro org) ──seed──> (fixture present) ──seed──>┘
                                   │
                                   └── suite run mutates it
                                       (blocks, reports, preferences,
                                        one new owner-signup workspace)
```

A re-seed is a transition **back into** the same state, not a new organization. Specifically, the
second run must:

- reuse the organization row, not create a second one (SC-004);
- refresh the primary and worker credentials, so a forgotten or rotated password cannot lock the
  suite out of its own fixture (`seed_demo.go`'s `refreshDemoPassword` pattern);
- reactivate any account a flow deactivated, since `delete-account.yaml` walks up to the
  confirmation and `removal-request.yaml` files a request;
- clear blocks between fixture accounts left by `block-person.yaml` / `block-from-profile.yaml`;
- restore the notification and dark-mode preferences that `settings/*.yaml` toggle — those
  flows put them back themselves, but a run that fails midway does not;
- recreate the overdue and unassigned ritual instances relative to a single `seededAt` clock, so
  no two helpers land on opposite sides of midnight (`seed_demo.go:110-112`);
- emit the same values as the first run, or correctly updated ones where an id changed.

The workspaces `onboarding/owner-signup.yaml` leaves behind are **not** cleaned up by the seeder.
They are derived from `MAESTRO_RUN_ID`, belong to no fixture, and removing them is
`make test-db-purge`'s job. Recorded here so their accumulation is a known property rather than a
surprise.
