# Compliance & Safety

Content reporting, blocking, account removal requests, and the resumable account
erase. Owned by `internal/compliance` (with the deletion RPCs on `internal/iam`,
because they act on the global `iam.user` record); contracts in
`rpc/v1/compliance.proto` (`ComplianceService`, 11 RPCs) and the deletion and terms
additions to `rpc/v1/iam.proto`.

**Status date: 2026-08-27.** Introduced by spec 036.

## Why this domain exists separately

A report can target a chat message, a direct message, an uploaded file, a document
comment or a call record. It belongs to none of those domains, and cross-schema
joins are forbidden (Constitution IV), so reporting composes them through service
calls instead. The `compliance` schema had been declared in `schema.sql` and empty
since the beginning; this is the first thing in it.

## The shared-UUID invariant

Load-bearing and, until this change, undocumented: **`iam.user.id`,
`iam.identity.id` and `organization.employee.id` are the same UUID for a person.**
`GetUserRoleNamesInOrg` filters `iam.employee_role.employee_id` with a JWT user id,
and account deletion enumerates memberships with
`SELECT organization_id FROM iam.identity WHERE id = $1`. There is no
user↔organization mapping table and none is needed. The invariant is now recorded
as a `COMMENT ON COLUMN iam.identity.id`.

## Account deletion

Two paths, decided by `iam.user.is_org_managed`:

| `is_org_managed` | Path | RPC | Surfaces |
|---|---|---|---|
| `false` (self-registered) | delete their own account | `IAMService.DeleteMyAccount` | web + mobile |
| `true` (admin-provisioned) | ask the workspace's owners | `ComplianceService.RequestAccountRemoval` | web + mobile |

`ComplianceService.GetAccountRemovalPath` tells a client which one applies, so
neither client infers it.

### What deletion actually does

**Anonymisation at the tenant layer, destruction at the global layer.**

Roughly fifty columns across a dozen schemas reference an employee id, and Citus
does not support `ON DELETE SET NULL`, so a cascade-based erase is neither
available nor desirable. Instead:

- `organization.employee` **survives** as a de-identified tombstone —
  `given_name` → `'Deleted'`, `family_name` → `'user'`, `email` → `''`,
  `date_of_birth` / `phone_number` / `home_address` / `additional_info` → `NULL`,
  `is_active` → `false`. The organization keeps its messages, files, tasks and
  documents; they stop naming anybody.
- Per organization, `iam.identity`, `iam.credential`, `iam.employee_role`,
  `iam.user_preference` and `iam.account_lockout` are **deleted**.
- Once no `iam.identity` row remains anywhere for the person, `iam.user` is
  deleted, which cascades to `iam.sso_identity`, `iam.password_credential`,
  `iam.password_reset_token` and `iam.session`.

Sessions are invalidated **synchronously in the request**, before anything is
queued, so a backed-up worker cannot leave a deleted person still signed in.

Deleting an account never deletes an organization.

### Refusals

- **Sole owner of a populated workspace.** Refused with `FAILED_PRECONDITION` plus
  a `SoleOwnerBlocksDeletion` detail (`iam_error_details.proto`) listing each
  blocking workspace with its name and member count, so a client can offer
  transfer-or-close rather than printing a sentence. Sole owner of an *empty*
  workspace is allowed: there is nobody to strand.
- **Admin-provisioned account.** Refused; that person's path is
  `RequestAccountRemoval`.
- **Wrong confirmation phrase.** `DeleteMyAccount` takes a phrase the person types.
  `GetAccountDeletionPreview` returns the phrase along with the erased and retained
  category lists, all assembled server-side so mobile and web state the same thing.

### `compliance.account_deletion`

One row per organization the person belongs to, driving a resumable background job
on the `flows` queue (`compliance-account-deletion/v1`):

```
pending ──▶ anonymising ──▶ purging ──▶ done
   │             │              │
   └─────────────┴──────────────┴──▶ failed  (retryable)
```

Every step is idempotent — anonymising an already-anonymised row is a no-op
`UPDATE`, and deleting already-deleted identity rows deletes nothing — so recovery
from a partial failure is "run it again", not a second code path. The terminal step
needs no marker column: whichever organization purges last finds zero remaining
`iam.identity` rows and destroys `iam.user`.

The worker runs on `AdminPool`, because the last step touches the global `iam.user`
row and there is no request context to derive a tenant from.

**Latency**: the `flows` worker polls one shard per workflow per tick, round-robin
across `FLOW_SHARD_COUNT` (32 by default) at one second, so a queued erase can wait
up to ~32 seconds before it starts. Deletion has no interactive latency target —
the person is signed out synchronously — so this is expected, not a fault.

### Cross-shard read on the deletion path

`SELECT organization_id FROM iam.identity WHERE id = $1` has no `organization_id`
predicate and fans out across shards. It runs on `AdminPool`. The justification
(Constitution I) is that finding every organization a person belongs to is exactly
the question no single tenant context can answer, and it runs only on the deletion
path — single digits per day at any plausible scale.

## Removal requests

`compliance.removal_request` — one outstanding request per person per organization,
enforced by a partial unique index on `(organization_id, employee_id) WHERE status =
'outstanding'`.

```
outstanding ──▶ granted   (ends the membership; enqueues the erase)
            └─▶ declined  (terminal for that request; they may ask again)
```

- `RequestAccountRemoval` returns the existing outstanding request rather than
  erroring on a repeat — a second tap is a person checking, not asking twice.
- Owners are notified with `notification_type = 'account_removal_requested'`,
  `source_domain = 'system'`. The notification shares the request's transaction: a
  recorded request nobody hears about is the off-app dead end both stores reject,
  so a notification failure rolls the request back rather than being swallowed.
- Granting runs the same erase as self-deletion, with
  `trigger = 'removal_request_granted'`.
- **Side effect**: `DeactivateOrgAccount` resolves any outstanding request to
  `granted`, so offboarding by the ordinary route does not leave a permanent
  unactionable item in the owner queue.
- `ListRemovalRequests` and `DecideRemovalRequest` require
  `compliance.manageRemovalRequests` and are **web-only** surfaces
  (Constitution XIII).

## Content reporting

`compliance.content_report` — the reporter, the reported author, the target, the
reason, and a **snapshot of the content as it stood at report time**.

`target_kind IN ('chat_message','direct_message','file','document_comment','call_record')`.
`target_id` is deliberately **not** a foreign key: it points into five different
schemas, and the snapshot is what makes the report reviewable regardless.

**The server resolves the author and the snapshot**, by calling the owning domain's
service (`chat.GetMessage`, `files.GetFileMetadata`,
`docs.GetCommentAuthorAndText`, `voice.GetCallRecord`) through interfaces declared
in `internal/compliance/resolvers.go`. The client supplies neither, so a report
cannot be pinned on the wrong person.

The snapshot is why a report **outlives deletion of its subject**: an author who
deletes the reported message does not erase the evidence.

- A second outstanding report from the same reporter against the same target is
  rejected at the logic layer (`ALREADY_EXISTS`), not by a constraint, so the
  rejection carries a useful message.
- `ListReports` pages newest-first on the UUID v7 id with a nullable cursor.
- `ResolveReport` requires a non-empty outcome note and refuses to re-resolve an
  already-resolved report. The `UPDATE` matches only `status = 'outstanding'`, so
  the guard holds at the SQL layer as well.
- Review requires `compliance.reviewReports` and is **web-only**.

## Blocking

`compliance.block` — a one-directional row per `(blocker, blocked)` pair, unique per
organization, with a CHECK that nobody blocks themselves. Unblocking deletes the
row; there is no history.

**Enforced at exactly two chokepoints**, not as a filter through every read path:

| Chokepoint | Owner | Behaviour |
|---|---|---|
| `CreateOrGetDirectMessage` | `internal/chat` | refuses with `FAILED_PRECONDITION` |
| voice call initiation in a direct conversation | `internal/voice` | refuses with `FAILED_PRECONDITION` |

Both domains declare their own local `ContactGuard` interface, satisfied
structurally by `compliance.Logic` and wired in `cmd/server.go`, so neither imports
`internal/compliance`. Voice resolves the counterpart of a direct conversation
through `chat.DirectMessageCounterpart` rather than reading chat's tables.

The check is **symmetric**: contact is refused whichever side blocked, so comparing
outcomes cannot reveal the direction.

### Scope, and why it is what it is

A block stops **direct** contact and does nothing to shared work channels. The
blocked person's messages in a shared channel stay visible to the blocker.

That is deliberate. Hiding a colleague's messages in a shared channel would let
somebody silently conceal work instructions addressed to them, which in a business
where messages are about where to be and what to do is a safety problem of its own.
It also avoids corrupting the per-member unread cursor, which advances past
messages a filter would have removed from the page.

Existing direct history is hidden **client-side** from the blocker's own view, with
a per-item reveal.

### Silence

- No notification is emitted anywhere on the block path.
- Blocking writes only to `compliance.block` — never to channel membership.
- There is no RPC that answers "who has blocked me". `ListBlockedPeople` returns the
  caller's own list only. The absence is the requirement.

## Terms acceptance

Two columns on the global, non-distributed `iam.user`: `terms_version_accepted` and
`terms_accepted_at`. No history table — only the current acceptance is required.

`iam.CurrentTermsVersion` (`internal/iam/connect_terms.go`) is the single
definition, mirrored by `TERMS_VERSION` in `frontend/packages/apis/src/legal.ts`.
Bumping it makes every stored acceptance stale, which is the re-prompt trigger.

- `RegisterOrganizationWithAdminPassword` and `AcceptInvitation` both require
  `accepted_terms_version` and reject a missing or stale value, so no account can
  exist without a recorded acceptance.
- `GetTermsStatus` / `AcceptTerms` gate first use for admin-provisioned workers,
  who never saw a signup screen. Mobile applies this in `TermsGate`, which wraps the
  authenticated app shell and fails open on a network error.

The published documents live once, on the web (`/privacy`, `/terms`). Mobile opens
them with `expo-web-browser` rather than carrying a second copy that would drift.

## Permissions

| Permission | Default roles | Surfaces |
|---|---|---|
| `compliance.reportContent` | Owner, Operator, Employee | mobile + web |
| `compliance.blockPerson` | Owner, Operator, Employee | mobile + web |
| `compliance.reviewReports` | Owner, Operator | web only |
| `compliance.manageRemovalRequests` | Owner, Operator | web only |

`GetAccountRemovalPath`, `RequestAccountRemoval`, `DeleteMyAccount`,
`GetAccountDeletionPreview`, `AcceptTerms` and `GetTermsStatus` require
authentication but no permission: every person must be able to reach their own
account-ending path regardless of how few permissions their role carries.

## Cross-stack enumerations

Five, each mirrored in four places (SQL `CHECK` → Go constants in
`internal/compliance/constants.go` → proto enum → TypeScript union in
`frontend/packages/apis/src/compliance.ts`): report target kind, report reason,
report status, removal-request status, account-deletion state. The TypeScript
wrapper maps proto enums to string unions at the boundary so no screen ever
compares a raw enum number.

## Store manifest

Not a runtime behaviour, but maintained by the same feature:
`frontend/apps/mobile/scripts/check-store-manifest.js` runs in `make test-mobile`
and fails the build on an unexpected permission, a background-location key, a
missing `POST_NOTIFICATIONS`, a development-only permission string, or a
disagreement between the manifest and
`docs/compliance/permission-justifications.md`.
