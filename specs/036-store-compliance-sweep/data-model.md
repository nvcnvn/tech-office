# Phase 1 Data Model: Store Compliance Sweep

All new tables are tenant tables in the `compliance` schema, which is already declared in
`backend/database/scripts/schema.sql` and currently holds none. Every one follows the Citus
rules from Constitution Principle I: `organization_id` first in the primary key and in every
unique index, composite foreign keys, no triggers, no `ON DELETE SET NULL`.

Column types below are indicative; the migration in
`backend/k8s/base/database/migrations/20260827000001_store_compliance.up.sql` is authoritative,
and `schema.sql` is updated in the same change set.

---

## `compliance.content_report`

One person's assertion that a specific item is abusive.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `DEFAULT uuidv7()` — also the pagination cursor |
| `organization_id` | `uuid NOT NULL` | FK `public.organization(id) ON DELETE CASCADE` |
| `reporter_employee_id` | `uuid NOT NULL` | composite FK to `organization.employee(organization_id, id)` |
| `reported_employee_id` | `uuid NOT NULL` | composite FK to `organization.employee(organization_id, id)` |
| `target_kind` | `text NOT NULL` | `CHECK IN ('chat_message','direct_message','file','document_comment','call_record')` |
| `target_id` | `uuid NOT NULL` | id within the owning domain; **not** a foreign key — see below |
| `content_snapshot` | `text NOT NULL` | the reported content as it stood at report time (R7) |
| `reason` | `text NOT NULL` | `CHECK IN ('harassment','hate_speech','sexual_content','violence','spam','other')` |
| `note` | `text` | optional free text from the reporter |
| `status` | `text NOT NULL DEFAULT 'outstanding'` | `CHECK IN ('outstanding','actioned','dismissed')` |
| `outcome_note` | `text` | what the reviewer did; required when leaving `outstanding` |
| `reviewed_by_employee_id` | `uuid` | composite FK; NULL while outstanding |
| `reviewed_at` | `timestamptz` | NULL while outstanding |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

```
PRIMARY KEY (organization_id, id)
INDEX (organization_id, status, id DESC)      -- the review queue, and the pagination cursor
INDEX (organization_id, reported_employee_id) -- repeat-target detection
```

**`target_id` is deliberately not a foreign key.** It points into five different schemas
depending on `target_kind`, and Principle IV forbids cross-schema references. The
`content_snapshot` is what makes the report reviewable regardless (FR-018), so the loose
reference costs nothing: it is a convenience for deep-linking to live content when it still
exists.

**Repeat reports** against the same target by the same reporter are rejected at the logic layer
rather than by a unique constraint, so that the rejection can carry a useful message.

---

## `compliance.block`

A one-directional block, scoped to an organization.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `DEFAULT uuidv7()` |
| `organization_id` | `uuid NOT NULL` | FK `public.organization(id) ON DELETE CASCADE` |
| `blocker_employee_id` | `uuid NOT NULL` | composite FK to `organization.employee` |
| `blocked_employee_id` | `uuid NOT NULL` | composite FK to `organization.employee` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

```
PRIMARY KEY (organization_id, id)
UNIQUE INDEX (organization_id, blocker_employee_id, blocked_employee_id)
INDEX (organization_id, blocked_employee_id)   -- "may this person contact me?" lookup
CHECK (blocker_employee_id <> blocked_employee_id)
```

Unblocking deletes the row. There is no history, and none is required.

The pair index exists in both directions because the two questions are asked from opposite
sides: the blocker's settings screen lists who *they* blocked, while the guard in
`CreateOrGetDirectMessage` asks whether the *initiator* has been blocked by the recipient.

---

## `compliance.removal_request`

An admin-provisioned worker asking to be removed from an organization (R4).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `DEFAULT uuidv7()` |
| `organization_id` | `uuid NOT NULL` | FK `public.organization(id) ON DELETE CASCADE` |
| `employee_id` | `uuid NOT NULL` | composite FK to `organization.employee` |
| `status` | `text NOT NULL DEFAULT 'outstanding'` | `CHECK IN ('outstanding','granted','declined')` |
| `note` | `text` | optional, from the requester |
| `decided_by_employee_id` | `uuid` | composite FK; NULL while outstanding |
| `decided_at` | `timestamptz` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

```
PRIMARY KEY (organization_id, id)
UNIQUE INDEX (organization_id, employee_id) WHERE status = 'outstanding'
INDEX (organization_id, status, id DESC)
```

The partial unique index enforces one outstanding request per person per organization — a
second tap re-surfaces the existing request rather than creating a duplicate. Citus supports
partial indexes provided `organization_id` is among the indexed columns, which it is.

**State machine**: `outstanding → granted` ends the membership and, if it was the person's last,
triggers the global purge in `compliance.account_deletion`. `outstanding → declined` is
terminal; the person may request again. An administrator offboarding the worker by the ordinary
route (a spec edge case) resolves any outstanding request to `granted` as a side effect, so it
does not linger.

---

## `compliance.account_deletion`

The resumable record of a deletion in progress (R3). Not tenant-scoped in the usual sense — it
tracks a *global* user — but it carries `organization_id` for the shard it is being processed
for, with one row per organization plus a final global row.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `DEFAULT uuidv7()` |
| `organization_id` | `uuid NOT NULL` | the organization this step erases; the terminal global step uses the person's last organization |
| `user_id` | `uuid NOT NULL` | the global `iam.user.id` |
| `state` | `text NOT NULL DEFAULT 'pending'` | `CHECK IN ('pending','anonymising','purging','done','failed')` |
| `trigger` | `text NOT NULL` | `CHECK IN ('self_service','removal_request_granted')` |
| `failure_reason` | `text` | populated on `failed` |
| `attempts` | `int NOT NULL DEFAULT 0` | retry counter for the background worker |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | set by application code — Citus forbids triggers |

```
PRIMARY KEY (organization_id, id)
INDEX (organization_id, state) WHERE state IN ('pending','anonymising','purging')
INDEX (organization_id, user_id)
```

**State machine**:

```
pending ──▶ anonymising ──▶ purging ──▶ done
   │             │              │
   └─────────────┴──────────────┴──▶ failed  (retryable; worker resumes from last state)
```

- `anonymising` — strip PII from `organization.employee`, set `is_active = false` (R1).
- `purging` — delete `iam.identity`, `iam.credential`, `iam.employee_role`,
  `iam.user_preference` for this organization. On the final organization, also delete
  `iam.user`, which cascades to `iam.sso_identity`, `iam.password_credential`,
  `iam.password_reset_token` and `iam.session`.

Sessions are invalidated **synchronously** in the originating request, before the job is
enqueued, so FR-003 holds even if the worker is backed up.

---

## Changes to existing tables

### `iam.user` — terms acceptance (R9)

| Column | Type | Notes |
|---|---|---|
| `terms_version_accepted` | `text` | NULL until first acceptance; compared against the current version constant to decide whether to re-prompt |
| `terms_accepted_at` | `timestamptz` | |

`iam.user` is global and not distributed, so no Citus constraints apply. No new table: the
requirement is the current acceptance, not a history (R9).

### `iam.identity` — documentation only

A `COMMENT ON COLUMN iam.identity.id` recording that it is the same UUID as `iam.user.id` and
`organization.employee.id` (R2). No structural change; this invariant is load-bearing and
currently undocumented.

### `public.permission` — four new rows

`compliance.reportContent`, `compliance.blockPerson`, `compliance.reviewReports`,
`compliance.manageRemovalRequests`, following the existing `domain.action` convention. The
first two are attached to every default role including Employee; the latter two to Owner and
Operator only, which is what keeps report review off mobile per Constitution XIII.

---

## Entity relationships

```
public.organization
  ├── organization.employee ──┬── compliance.content_report (reporter, reported)
  │                           ├── compliance.block (blocker, blocked)
  │                           └── compliance.removal_request (employee, decided_by)
  └── compliance.account_deletion ──▶ iam.user (by id, no FK — different shard topology)

iam.user (global, not distributed)
  ├── terms_version_accepted, terms_accepted_at        [new columns]
  ├── iam.sso_identity, iam.password_credential,
  │   iam.password_reset_token, iam.session            [existing, ON DELETE CASCADE]
  └── shares its id with iam.identity.id and organization.employee.id   [R2]
```

`compliance.account_deletion.user_id` has no foreign key to `iam.user`: the former is a
distributed tenant table and the latter is a global reference table, and the row must survive
the moment `iam.user` is deleted so that `done` is observable.

---

## Validation rules drawn from the spec

| Rule | Source | Enforced at |
|---|---|---|
| A report must carry a reason from the fixed list | FR-015 | SQL `CHECK` + proto enum |
| A report stays listed until an outcome is recorded | FR-018 | `status` default `outstanding`; snapshot makes it reviewable after target deletion |
| Leaving `outstanding` requires an outcome note | FR-017 | logic layer |
| Nobody may block themselves | FR-019 | SQL `CHECK` |
| One block per ordered pair | FR-019 | unique index |
| A block never notifies the blocked person | FR-022 | no notification emitted on the block path |
| A block never removes anyone from a channel | FR-023 | blocking writes only to `compliance.block` |
| Sole owner of a populated organization cannot delete | FR-005 | logic layer; returns the structured error detail from `iam_error_details.proto` |
| Provisioned workers cannot self-delete | FR-007a | logic layer branch on `iam.user.is_org_managed` |
| Global identity data goes when the last membership goes | FR-007e | final `purging` step |
| One outstanding removal request per person per org | FR-007c | partial unique index |
