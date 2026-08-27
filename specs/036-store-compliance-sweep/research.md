# Phase 0 Research: Store Compliance Sweep

Decisions taken before design, each with the alternatives that were rejected. Findings are
from reading the current code, not from the numbered specs.

---

## R1 — Account deletion: anonymise the tenant record, destroy the global record

**Decision**: Deleting a person does **not** delete their `organization.employee` row. That row
is stripped of personal data and kept as a tombstone (`given_name` → "Deleted", `family_name` →
"user", `email` → `''`, `date_of_birth`/`phone_number`/`home_address`/`additional_info` → NULL,
`is_active` → false). Everything global is destroyed: `iam.user` and, by existing cascade,
`iam.sso_identity`, `iam.password_credential`, `iam.password_reset_token`, `iam.session`. Per
organization, `iam.identity`, `iam.credential`, `iam.employee_role` and `iam.user_preference`
rows are deleted.

**Rationale**: The schema has roughly fifty columns across a dozen schemas referencing an
employee id — `author_employee_id`, `sender_employee_id`, `uploaded_by_employee_id`,
`initiator_employee_id` and so on. Erasing the employee row would either break every one of
those references or require a fifty-table sweep in a single transaction. Citus removes the
usual escape hatch: `ON DELETE SET NULL` is not supported on distributed tables, so
cascade-based de-referencing is not available at any price.

The tombstone gives FR-006 exactly what it asks for — content stays legible to the
organization while ceasing to identify the person — for the cost of one `UPDATE`. It also
matches the owner's stated position that workplace content belongs to the employing
organization rather than the individual.

**Alternatives considered**:
- *Hard-delete the employee row and every referencing row.* Rejected: fifty tables, a
  cross-shard transaction, and it destroys the organization's business records, which is
  precisely what the owner said must not happen.
- *Soft-delete via `is_active = false` alone, leaving names in place.* Rejected: the personal
  data is still there, so it does not satisfy either store's deletion requirement or a
  reasonable reading of erasure.
- *Rewrite every referencing row to a shared "deleted user" sentinel id.* Rejected: same
  fifty-table sweep as a hard delete, with the added downside that two different deleted people
  become indistinguishable in audit trails.

---

## R2 — The three identity layers share one UUID

**Finding**: `iam.user.id`, `iam.identity.id` and `organization.employee.id` are the same value
for a given person. This is not documented anywhere but is load-bearing:
`GetUserRoleNamesInOrg` in `backend/database/scripts/iam.query.sql:243` filters
`iam.employee_role.employee_id` with a parameter named `user_id`, and `SwitchOrganization`
passes the JWT's user id straight into it.

**Consequence**: There is no user↔organization mapping table, and none needs to be added.
Enumerating a person's memberships is `SELECT organization_id FROM iam.identity WHERE id = $1`.

**Risk recorded**: this invariant is implicit. The migration adds a comment on `iam.identity.id`
stating it, so the next person to touch it does not have to re-derive it from a query's
parameter name.

---

## R3 — Deletion runs as a resumable background job

**Decision**: `DeleteMyAccount` writes an `compliance.account_deletion` record in state
`pending`, invalidates every session synchronously, and enqueues the erase on the existing
background queue. The worker advances the record through `anonymising` → `purging` → `done`,
and a failure leaves it in the last completed state for retry.

**Rationale**: Principle XI requires distributed-first design, and the spec's edge cases
explicitly call out "deletion is requested and the request fails partway through". The person
must be signed out immediately regardless — that part is synchronous and cheap — but touching
one employee row per organization plus the global cascade is not something to do inside a
request. The state record is what makes a partial failure detectable instead of silent.

**Alternatives considered**:
- *Do it all synchronously in one transaction.* Rejected: spans shards for a multi-org person,
  and a timeout leaves no record that deletion was ever requested.
- *Fire-and-forget goroutine.* Rejected: a process restart loses the work with no trace, which
  is the exact failure the edge case names.

---

## R4 — Two deletion paths, keyed off `iam.user.is_org_managed`

**Decision**: The column that decides which path a person gets already exists.
`is_org_managed = false` (self-registered) gets full deletion per R1. `is_org_managed = true`
(admin-provisioned worker) gets a `compliance.removal_request` addressed to the organization's
owners; when an owner grants it, the person's membership in that organization ends, and if that
was their last membership the R1 global purge runs.

**Rationale**: Both stores' rules are keyed to accounts the person *created*. A provisioned
worker did not create theirs, and the workplace content in it is the employer's record. The
distinction is already modelled, so this is a branch rather than a subsystem.

**Rejection recorded for the reviewer notes**: telling a provisioned worker to "contact your
administrator" and stopping there reads as the prohibited off-app deletion path. The in-app
request that notifies an owner is what makes this compliant rather than evasive, and the
reviewer notes must say so explicitly.

---

## R5 — Cross-shard read on the deletion path, on AdminPool

**Decision**: `SELECT organization_id FROM iam.identity WHERE id = $1` has no `organization_id`
predicate and therefore fans out across shards. It runs on `AdminPool`, not `TenantPool`.

**Justification** (required by Principle I): the query is unavoidable — the whole point is to
find every organization a person belongs to, so no single tenant context can answer it. It runs
at most twice per account deletion, an operation measured in single digits per day at any
plausible scale. `TenantPool` cannot serve it because it enforces an `organization_id` context
that this query is defined by not having.

---

## R6 — `compliance` schema, `internal/compliance` package

**Decision**: Reports, blocks, removal requests and deletion records go in the `compliance`
schema, served by a new `internal/compliance` package and `rpc/v1/compliance.proto`.

**Rationale**: The schema is already declared in `schema.sql` and has never held a table, so
this is occupying reserved space rather than inventing a new namespace. A report can target a
chat message, an uploaded file, a document comment or a call record — it belongs to none of
those domains, and Principle IV forbids the cross-schema joins that would otherwise let
`internal/chat` own it.

**Alternatives considered**:
- *Put reports in `chat`.* Rejected: files, documents and calls are equally reportable, and
  chat would become a dumping ground for other domains' moderation.
- *One table per reportable domain.* Rejected: four near-identical tables and four review
  screens, when the review workflow is identical regardless of what was reported.

---

## R7 — Reports store a content snapshot

**Decision**: `compliance.content_report` stores the reported content inline at report time —
the text, or a description and reference for a file or call — rather than only a foreign key.

**Rationale**: FR-018 requires a report to remain reviewable after its subject is deleted, and
the spec's edge cases name "a reported item is deleted by its author before the report is
reviewed" explicitly. A foreign key alone leaves the reviewer looking at a tombstone. It also
means the review screen needs no cross-domain fan-out to render, which keeps Principle IV
satisfied without a join.

**Cost accepted**: the snapshot is duplicated data that can diverge from an edited original.
That is correct behaviour here — the report is about what was said at the time it was reported.

---

## R8 — Blocking enforced at two chokepoints, not as a read filter

**Decision**: A block is enforced in exactly two places: `CreateOrGetDirectMessage` in
`internal/chat`, and voice-call initiation in `internal/voice`. Existing direct-message history
is hidden client-side from the blocker's view. Shared workplace channels are untouched.

**Rationale**: The owner scoped blocking to direct contact, on the grounds that hiding a
colleague's messages in a shared channel would let someone silently conceal instructions
addressed to them. That decision shrinks the implementation from "a filter threaded through
every message read path" to "two guards", and removes the risk of a block quietly corrupting a
shared channel's unread cursors.

**Alternatives considered**:
- *`WHERE sender NOT IN (blocked)` in `ListMessages`.* Rejected on the owner's product
  decision, and separately because it interacts badly with the per-member unread cursor:
  messages filtered out of a page still advance `last_viewed_message_id`.
- *Block as a channel-membership removal.* Rejected: it is visible to the blocked person, which
  FR-022 forbids, and it would remove them from work they need.

**Reviewer-notes consequence**: a reviewer who tests blocking inside a shared channel will
expect messages to vanish and will not see that happen. The notes must state that blocking is
scoped to direct contact because the app is a closed workplace tool.

---

## R9 — Terms acceptance is two columns on `iam.user`, not a table

**Decision**: `iam.user` gains `terms_version_accepted TEXT` and `terms_accepted_at TIMESTAMPTZ`.

**Rationale**: The agreement is between the person and Tech Office, not between the person and
an organization, so it belongs on the global user record — which is also the one table in the
schema that is legitimately not tenant-scoped. A history of every version a person ever
accepted is not required by either store and nobody has asked for it; the current version and
when they accepted it is the whole requirement. When the terms change, bumping the version
string makes everyone's stored value stale, which is the re-prompt trigger.

**Alternatives considered**:
- *`compliance.terms_acceptance` table with one row per acceptance.* Rejected as unrequested
  history. If a legal need for the full trail appears, the table can be added then and
  backfilled from the two columns.

---

## R10 — Legal pages live once, on the web, and mobile opens them

**Decision**: `/privacy` and `/terms` are ordinary Next.js routes on the existing marketing
site. The mobile app links to them with `expo-web-browser`, which is already a dependency.

**Rationale**: One copy of the text. Both stores need a public URL regardless, so the web page
has to exist; a second native copy would drift and would need a release to correct a typo. The
site runs `output: "standalone"` with no auth on marketing routes, so the pages are public by
default.

---

## R11 — Manifest hygiene is enforced by a check script, not a one-time cleanup

**Decision**: Add `frontend/apps/mobile/scripts/check-store-manifest.js`, run in CI, asserting
that the generated `Info.plist` and `AndroidManifest.xml` contain exactly the expected set of
permissions and no development-only entries. Unwanted transitive Android permissions are
suppressed with `android.blockedPermissions` in `app.json`.

**Current findings the script must lock in**:

| Entry | Platform | Action |
|---|---|---|
| `NSLocationAlwaysUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` | iOS | Remove — only `requestForegroundPermissionsAsync` is ever called (`task/[taskId].tsx:146`, `(calendar)/[eventId].tsx:67`) |
| `NSLocalNetworkUsageDescription`, `NSBonjourServices` | iOS | Remove from production — the string literally says "local development server while debugging" |
| `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSFaceIDUsageDescription` | iOS | Rewrite — currently framework defaults or generic; must name the feature |
| `NSLocationWhenInUseUsageDescription` | iOS | Rewrite — "ritual task verification" is internal vocabulary a reviewer cannot parse |
| `SYSTEM_ALERT_WINDOW` | Android | Block — transitive, nothing in the app draws an overlay |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` | Android | Block — legacy broad storage; the image picker uses scoped access |
| `POST_NOTIFICATIONS` | Android | **Add** — absent today, so push is silently dropped on Android 13+ |
| `ITSAppUsesNonExemptEncryption: false` | iOS | Add — removes the export-compliance prompt on every build |

**Rationale**: A cleanup regresses the first time someone adds a library. Both stores treat an
undeclared-but-present or declared-but-unused permission as a finding, and the Android
notification permission is a live functional bug, not only a compliance one — push does not
arrive on any recent Android device today.

---

## R12 — Demo workspace is a seeded, idempotent tools subcommand

**Decision**: `backend/cmd/tools.go` gains a `seed-demo-org` subcommand producing a workspace
with realistic chat, tasks, calendar entries, documents and at least one reportable message.

**Constraint discovered**: temporary PINs expire after three days and force
`pin_change_required` (`docs/domain/auth-identity.md`). A demo PIN account created the ordinary
way would be dead before a reviewer reached it. The seed must set a permanent PIN directly.

**Consequence for FR-032**: the reviewer's *primary* credential must be a self-registered
account, because that is the only one whose settings screen shows the full deletion path. The
PIN account is offered second, with the reason for its different path explained in the notes.

---

## R13 — Four enumerations need four-way synchronisation

**Decision**: Report reason, report outcome, removal-request status and deletion state each
get a SQL `CHECK`, Go constants in `internal/compliance/constants.go`, a proto enum, and a
TypeScript union — kept in lockstep, one atomic task per enumeration.

**Rationale**: Principle VIII exists because this drifts. The existing schema carries explicit
warnings about it (`chat.channel_membership.notification_preference` is commented "MUST align
with backend constants … proto enum … and frontend TypeScript types"). Four new enumerations
in one change set is the highest-risk part of this epic for silent divergence, which is why the
plan keeps them as named tasks rather than incidental work inside the table migrations.
