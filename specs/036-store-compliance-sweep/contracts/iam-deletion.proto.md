# Contract: additions to `rpc/v1/iam.proto` and `iam_error_details.proto`

Account deletion and terms acceptance extend the existing IAM surface rather than joining the
new compliance service, because they act on the global `iam.user` record.

---

## `DeleteMyAccount` — authenticated, no additional permission

FR-001, FR-002, FR-003, FR-004, FR-005, FR-007.

**Request**: `confirmation_phrase` — the person types a fixed phrase, guarding against an
accidental irreversible tap on a small screen.

**Response**: `deletion_id`, `state`.

**Behaviour**:

1. Rejects with `failed_precondition` if `iam.user.is_org_managed` is true — that person's path
   is `RequestAccountRemoval` (FR-007a).
2. Rejects with `failed_precondition` plus the structured detail below if the caller is the
   sole owner of any organization that still has other members (FR-005).
3. Otherwise: invalidates every session synchronously (FR-003), writes the
   `compliance.account_deletion` records, and enqueues the background erase (R3).

Deleting an account never deletes an organization (FR-007). Closing an organization stays a
separate, administrator-only, web-only action.

### Structured error detail: `SoleOwnerBlocksDeletion`

Added to `rpc/v1/iam_error_details.proto` per Principle X.

Fields: repeated `{ organization_id, organization_name, member_count }`.

Without this, the client can only show a sentence. With it, mobile and web can list exactly
which workspaces are blocking and link to transfer-or-close for each, which is what FR-005's
"MUST tell the person what to do instead" requires.

---

## `GetAccountDeletionPreview` — authenticated

FR-002. Returns what the confirmation screen must state: which data is erased, which is
retained and why, and the organizations affected. The copy is assembled server-side so that
mobile and web cannot drift into describing different behaviour.

**Response**: `erased_categories`, `retained_categories` with a reason for each,
affected organizations, and whether any sole-ownership block applies.

Retained categories are not a legal disclaimer bolted on — they describe R1's tombstone
honestly: messages, files, tasks and documents authored inside an organization remain with
that organization, de-identified.

---

## `AcceptTerms` — authenticated

FR-010, FR-011, FR-012.

**Request**: `terms_version`.

Sets `terms_version_accepted` and `terms_accepted_at` on `iam.user`. Rejects a version that is
not the current one, so a stale client cannot record acceptance of terms nobody is serving.

## `GetTermsStatus` — authenticated

FR-012. Returns the current version and whether this person has accepted it. Provisioned
workers who never saw a signup screen are gated on this at first use, which is the only way
FR-012 can hold for accounts an administrator created.

---

## Signup changes

`Signup` and `AcceptInvitation` gain a required `accepted_terms_version` field. A request
without it, or with a stale version, is rejected. This is a breaking change to both call sites;
per the project's no-backward-compatibility stance it ships atomically across backend, web and
mobile rather than being introduced as an optional field.
