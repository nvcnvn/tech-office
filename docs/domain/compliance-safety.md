# Compliance & Safety

Content reporting, blocking, account removal requests, and the resumable account
erase. Owned by `internal/compliance` (with the deletion RPCs on `internal/iam`,
because they act on the global `iam.user` record); contracts in
`rpc/v1/compliance.proto` (`ComplianceService`, 11 RPCs) and the deletion and terms
additions to `rpc/v1/iam.proto`.

**Status date: 2026-09-12.** Introduced by spec 036; the demo workspace section from
spec 055; the per-surface control map from spec 056.

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

Roughly fifty columns across a dozen schemas reference an employee id, so a
cascade-based erase would be a sprawling and fragile thing to maintain. Instead:

- `organization.employee` **survives** as a de-identified tombstone —
  `given_name` → `'Deleted'`, `family_name` → `'user'`, `email` → `''`,
  `date_of_birth` / `phone_number` / `home_address` / `additional_info` → `NULL`,
  `is_active` → `false`. The organization keeps its messages, files, tasks and
  documents; they stop naming anybody.
- Per organization, `iam.identity`, `iam.credential`, `iam.employee_role`,
  `iam.user_preference`, `iam.tour_progress` and `iam.account_lockout` are **deleted**.
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

### Where the report control actually is

Every surface that renders content somebody made carries a report control, and each
one mounts the *same* form — `components/compliance/report-sheet.tsx` on mobile,
`workspace/components/ReportContentDialog.tsx` on web. There is exactly one of each
per client; a new surface adds a button, never a form.

| Surface | File | Control | Test id | `targetKind` | Subject |
|---|---|---|---|---|---|
| Channel message (mobile) | `app/(app)/(chat)/[channelId].tsx` | action-sheet row | `message-action-report` | `direct_message` if the channel is direct, else `chat_message` | this message |
| Chat message (web) | `workspace/chat/components/MessageItem.tsx` | ⋮ menu item | `message-menu-report` | as above | this message |
| Thread parent and replies (mobile) | `app/(app)/(chat)/thread/[messageId].tsx` | action-sheet row | `message-action-report` | decided by the **parent conversation**'s type | this message |
| File list row (mobile) | `app/(app)/(more)/files/index.tsx` | button beside Download | `file-report-<fileId>` | `file` | this file |
| File detail (mobile) | `app/(app)/(more)/files/[fileId].tsx` | button beside Download | `file-detail-report` | `file` | this file |
| Files table row (web) | `workspace/files/components/ManagementTab.tsx` | flag icon in Actions | `file-report-btn-<fileId>` | `file` | this file |
| Document comment (web) | `workspace/docs/components/CommentsPanel.tsx` | flag icon in the comment's actions | `comment-report-<commentId>` | `document_comment` | this comment |

`call_record` is an accepted target kind with a registered resolver and **no control
anywhere** — it is reachable only by an API caller, deliberately.

The thread screen's route under `(shared)/resource/chat/thread/[messageId].tsx`
re-exports the same component, so the control is on both routes from one edit.

### How a refusal reaches the person

Both forms keep the content on screen and stay open on a refusal; neither ever reports a
success the server did not give. Two things make that true in practice rather than only
in principle:

- `rpcWrapper.ts` surfaces `ConnectError.rawMessage`, not `.message` — the latter carries
  a `[code] ` prefix meant for logs, so the mobile sheet used to read
  "[already_exists] you have already reported this item". `AlreadyExists` also has its own
  branch there; it used to fall through to the `NetworkError` default, typing a refusal a
  person is meant to read as a transport failure.
- `ReportSheet` renders the error **above** the reason list. The sheet is 85% of the
  screen height and its body scrolls; with the error under the note field it fell below
  the fold on a tall narrow Android screen, so a refused report looked like nothing had
  happened. The body scrolls back to the top when an error appears.

Reporting a **soft-deleted file** is refused with `COMPLIANCE_REPORT_TARGET_NOT_FOUND`:
the metadata row survives a delete, so `fileResolver` checks `IsDeleted` explicitly
rather than relying on the lookup to fail. A message reported *before* its author
deletes it keeps its snapshot — that is the opposite case and still holds.

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

### Where the block control actually is

| Surface | File | Control | Test id | Shown when |
|---|---|---|---|---|
| Channel message (mobile) | `app/(app)/(chat)/[channelId].tsx` | action-sheet row | `message-action-block` | `messageKind !== 'system' && authorEmployeeId && authorEmployeeId !== self` |
| Thread message (mobile) | `app/(app)/(chat)/thread/[messageId].tsx` | action-sheet row | `message-action-block` | identical predicate |
| Person profile (mobile) | `app/(app)/(more)/people/[employeeId].tsx` | button under the header | `person-block-button` | block list resolved, not your own entry, not already blocked |
| Person profile (mobile) | same file | button under the header | `person-unblock-button` | block list resolved, not your own entry, already blocked |

The `messageKind !== 'system'` clause matters: system rows carry the **acting**
employee in `author_employee_id` (`internal/chat/logic.go` inserts `actorID`), not a
speaker, so without it "X created task ABC-12" would offer "Block X". A system row
is reportable; it is not blockable.

The profile decides between Block and Unblock by reading `ListBlockedPeople` under
the query key `["compliance","blocked-people"]` — the same key the channel screen
uses. One `invalidateQueries` after `BlockConfirm.onDone` settles every mounted
screen, which is why the control flips in place without navigating away. While that
query is unresolved the profile renders **no** contact control at all, rather than
guessing and flipping.

Every mobile block and unblock goes through `components/compliance/block-confirm.tsx`;
there is exactly one confirmation on the client.

**Web cannot create a block.** `workspace/settings/blocked/page.tsx` lists blocks and
unblocks them; there is no web surface that starts one. Recorded as a known gap in
the drift register.

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

## The demo workspace a reviewer signs into

`backend/cmd/seed_demo.go` (`go run ./cmd seed-demo-org --subdomain demo`) creates or
refreshes the workspace the reviewer notes hand to a store reviewer. It is idempotent: a
second run refreshes the same organization rather than creating another, and every date it
writes derives from a single instant captured at the top of the run, so a re-seed the
morning of a resubmission produces content that reads as current.

It leaves **three sign-in credentials** and enough content that no mobile tab opens on an
empty state:

| Credential | Kind | Purpose |
|---|---|---|
| `owner@<subdomain>.demo.invalid` | self-registered owner | the primary credential; used for everything except the deletion |
| `spare@<subdomain>.demo.invalid` | self-registered owner | **the account the notes nominate for deletion** |
| `demo-worker` + permanent PIN | admin-provisioned | shows the removal-request path instead |

**Two owners is the load-bearing part.** The sole-owner refusal above is correct and is not
touched, but with one owner it made the workspace's only deletable credential undeletable,
so a reviewer asked to demonstrate in-app account deletion could not finish. A second
self-registered owner makes `ownerCount = 2`, the first clause of the refusal fails for
both, and either deletion is accepted while the workspace survives with an owner and all of
its content. The spare's rows mirror steps 2–6 of `RegisterOrganizationWithAdmin` against
the existing organization — `iam.identity`, `organization.employee` and `iam.user` sharing
one UUID, a recorded terms acceptance, a password credential and the organization's `owner`
role — with `iam.user.is_org_managed` left at its `FALSE` default, which is what makes the
settings screen offer deletion rather than a removal request.

A re-run after a reviewer has performed the deletion finds no active employee at the spare's
address, because the erase anonymised that row and destroyed its identity, and creates a
fresh account with a new UUID. The anonymised tombstone is left exactly as it is — it is
`is_active = FALSE`, so it is outside `CountOrganizationOwners`, `CountActiveOrganizationMembers`
and the people directory. The demonstration is therefore repeatable.

The content the seed writes, beyond the `site-updates` conversation and its reportable
message: six standard work items in the default `General` project across two open states,
with every credential holding two and at least one late and one due today; and a ritual-mode
`Site operations` project holding one `Open-up checks` definition with two instances — one
`overdue` and assigned to the worker, one scheduled for today with nobody holding it. The
definition carries `completion_window_hours = 720` and a monthly recurrence with
`generation_window_days = 1`, which is what keeps the reconciliation sweep from writing the
late instance off as `missed` and the generation sweep from adding a third instance. See
[rituals-tasks.md](rituals-tasks.md) for both sweeps.

A workflow state the seed needs but cannot find is a hard failure naming the project and the
category, not a warning: a half-shaped workspace reaching a reviewer silently is the failure
the loudness exists to prevent.

## Review materials

Four documents under `docs/compliance/` are pasted into a store console at submission,
which makes every sentence in them a claim a reviewer will check against the app:

| Document | Pasted into |
|---|---|
| `reviewer-notes.md` | App Store Connect → App Review Information → Notes; Play Console → Testing instructions |
| `permission-justifications.md` | App Review notes; Play Console Data safety and sensitive-permission declarations |
| `data-collection-inventory.md` | App Store Connect privacy questionnaire; Play Console Data safety form |
| `age-rating-answers.md` | Both stores' age-rating questionnaires |

`reviewer-notes.md` lists the three credentials above in one place, primary first, and names
**exactly one** of them — the spare owner — as the account to delete, in both the credential
section and `### Account deletion`. Naming one account unmistakably is the point: a reviewer
who deletes the primary credential instead is not blocked, because either deletion is
accepted, but they lose the sign-in the rest of the notes assume they still have.

**The device permissions the notes describe are exactly the five the app declares** —
microphone, camera, photos, location (foreground only) and notifications. There is no
biometric sign-in anywhere in the product, on any screen or in any dependency, and no
compliance document describes one as a capability: the reviewer notes name it under
`### Not requested`, the inventory names it under `### Not collected`, and the
justifications record the blocked Android permissions and the absent iOS key. Those
are statements of absence, which is the only sanctioned way for this document set to
name a capability the app does not have.

Age-rating answers live in `age-rating-answers.md` and nowhere else. It answers each
store's questionnaire separately, carries the evidence behind every answer, states the
closed-workspace boundary before the answers so the honest `Yes` answers to messaging
and user-posted content are not read as a social network, and carries the date its
answers were last checked against the live forms.

## Store manifest

Not a runtime behaviour, but maintained by the same feature:
`frontend/apps/mobile/scripts/check-store-manifest.js` runs in `make test-mobile`
and fails the build on an unexpected permission, a background-location key, a
missing `POST_NOTIFICATIONS`, a development-only permission string, a
disagreement between the manifest and
`docs/compliance/permission-justifications.md`, or a compliance document that
names a capability the app does not declare.

### The compliance-prose rule

Section 4 of the script, added by feature 054. The justifications cross-check above
reads one document; this one reads **every** `*.md` directly under
`docs/compliance/`, discovered with `readdirSync` rather than a hard-coded list, so a
fifth document is covered the day it is added.

It matches a fixed **capability vocabulary** — `CAPABILITY_TERMS`, thirteen
lower-cased substrings (`face id`, `touch id`, `biometric`, `fingerprint`,
`background location`, `always-on location`, `bluetooth`, `healthkit`,
`speech recognition`, `motion and fitness`, `nfc`, `contact list`, `address book`),
each paired with the manifest key or Android permission that would make naming it a
true claim. A match passes if that declaration is in
`ALLOWED_IOS_KEYS ∪ ALLOWED_ANDROID_PERMISSIONS` — the sets the same script already
uses to decide what the app may declare, so there is no second list of what the app
has. The terms are compound where the bare word would be ambiguous; `location`,
`camera`, `photos`, `microphone` and `notifications` are absent because they are
declared and would pass trivially, and `calendar` and `contacts` are absent because
they are this product's own feature words.

**The one exemption is a recorded-absence section**, declared per document in
`RECORDED_ABSENCE_SECTIONS`: `Permissions deliberately blocked` and
`Keys deliberately absent` in `permission-justifications.md`, `Not collected` in
`data-collection-inventory.md`, `Not requested` in `reviewer-notes.md`, and
`Capabilities the app does not have` in `age-rating-answers.md`. A section opens at
its heading (`#` to `######`, matched case-insensitively after trimming), includes
its own heading line, and closes at the next heading of the same or shallower level
or at end of file — a deeper sub-heading does **not** close it. The parser is
exported and asserted by `scripts/check-compliance-prose.check.js`, a dependency-free
`assert` self-check over in-memory document strings.

The exemption is a declared section rather than negation detection, deliberately.
Allowing any sentence containing "no", "not" or "never" would work on today's text
and fails open in the dangerous direction: *"Face ID sign-in requires no additional
setup"* passes a negation check while being exactly the false promise the rule
exists to catch.

A failure names the document, the line, the term, the unsatisfied declaration and
the declared headings for that file, so the fix needs no reading of the script:

```
docs/compliance/reviewer-notes.md:131: "face id" names a capability the app does not
declare (NSFaceIDUsageDescription is not in the allowed set). Either the app must
declare it, or the sentence must move into a recorded-absence section (Not requested).
```

What it deliberately does not do: parse English (a sentence describing an
unimplemented capability in words outside the vocabulary passes), scan outside
`docs/compliance/`, or track code fences.

It passes at HEAD, so `make test-mobile` is the suite's entry point again. Feature 053 removed the five declarations it was complaining about — the two `NSLocationAlways*` keys, `NSFaceIDUsageDescription`, and the `NSLocalNetworkUsageDescription`/`NSBonjourServices` pair — at their source in `app.json` (`locationAlwaysPermission: false`, `locationAlwaysAndWhenInUsePermission: false`, `faceIDPermission: false`, and the two biometric Android permissions added to `blockedPermissions`), so a regeneration reproduces the removal rather than undoing it. The local-network keys are needed only by a debug build reaching Metro over the LAN. They are not simply *not added*: `expo-dev-launcher`'s config plugin, autolinked through `expo-dev-client`, writes `NSBonjourServices` and `NSLocalNetworkUsageDescription` on **every** prebuild and strips them again only in a non-Debug Xcode build phase — too late for a committed prebuild, which is the artifact EAS builds and the gate reads. `plugins/with-dev-local-network.js` therefore owns both keys outright: it deletes them unless `EXPO_LOCAL_DEV_NETWORK=1`, and writes the app's own strings when that is set. The gate now also reads purpose strings out of the committed `ios/TechOffice/Info.plist`, not only out of `app.json` — which is where the framework placeholder `Allow $(PRODUCT_NAME) to access your location` actually lived.
