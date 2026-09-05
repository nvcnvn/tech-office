# Phase 1 Data Model: Document Edit Conflict Protection

**No DDL, no migration, no new table, no new column.** This feature adds a rule over
data that already exists. The model below records what that data guarantees, because
the correctness of the whole feature rests on one invariant.

---

## Entities

### Document — `docs.document` (existing, unchanged)

| Column | Type | Role in this feature |
|---|---|---|
| `organization_id` | `uuid NOT NULL` | Tenant key; leading predicate of every query, unchanged |
| `id` | `uuid NOT NULL` (uuidv7 default) | Document identity |
| `version_count` | `integer NOT NULL DEFAULT 1`, `CHECK (version_count >= 1)` | **The concurrency token.** The current version number, and the value a client must echo back as its base version |
| `content_json`, `content_text`, `title`, `slug`, `updated_at` | — | What the update writes; unchanged |
| `is_deleted` | `boolean NOT NULL DEFAULT false` | Already a predicate on the update; unchanged |

Primary key `(organization_id, id)`. Exposed to clients as `Document.version_count`
(field 12), which is what makes the token available to an editor with no new read.

### Document version — `docs.document_version` (existing, unchanged)

| Column | Role in this feature |
|---|---|
| `version_number` | `1..N`, contiguous, never reused, never pruned |
| `author_employee_id` | Supplies the conflicting author (FR-006), joined to `organization.employee` by the existing `GetVersion` query, which already returns `author_name` |
| `created_at` | Supplies "when" (FR-006) |
| `content_json`, `content_text`, `summary` | Unchanged |

### Base version (new, transport only)

Not stored anywhere. It is the `int32` a client sends on
`UpdateDocumentRequest.base_version`, being the `version_count` that client last read.
It exists only for the duration of one request.

---

## The invariant everything rests on

> For every live document, `docs.document.version_count` equals
> `MAX(docs.document_version.version_number)` for that document.

Established by construction, and verified against the code:

| Path | Effect on `version_count` | Effect on `document_version` |
|---|---|---|
| `CreateDocument` (the only `INSERT INTO docs.document` in the repository) | defaults to `1` | inserts version `1`, same transaction |
| `UpdateDocument` | `version_count + 1` | inserts `MAX + 1`, same transaction |
| `UpdateDocumentStatus` | untouched | none |
| `SoftDeleteDocument`, `OrphanChildren`, child/follower counters | untouched | none |

There is no version-restore or version-prune path in `DocumentVersionService`
(`ListVersions`, `GetVersion`, `GetVersionDiff`, `GetBlame` — all reads).

Two consequences the feature depends on:

1. **A base version is never ambiguous.** It is either the current version or
   definitively behind it; it can never name a pruned or renumbered version.
2. **`base_version = 0` — a client that omitted the field — can never match**, because
   the column's `CHECK` forbids values below 1. FR-003's "omits the base version"
   case therefore needs no special-casing.

`embed_logic.go` already reads `version_count` as a version number when snapshotting
an embed target and computing embed staleness, so this invariant is load-bearing
today and is merely being written down.

---

## State transitions

A document's `version_count` moves in exactly one direction, by exactly one, and only
through a successful `UpdateDocument`:

```
        base = version_count                       base ≠ version_count
        (or the row lock is won)                   (or the row lock is lost)
             │                                              │
   v=N ──────┴──────► v=N+1                     v=N ────────┴────────► v=N
   content replaced, version N+1 created,        nothing written, no version
   embeds synced, slug history on rename,        created, transaction rolled
   followers notified   (FR-008)                 back, ABORTED returned (FR-002)
```

There is no third outcome, and no path that merges (FR-013).

---

## Validation rules

| Rule | Where enforced | Requirement |
|---|---|---|
| Caller holds `docs.update` | Auth interceptor, before the transaction | pre-existing |
| Caller has write access to this document | `CheckAccess`, first thing inside the transaction — **before** the version check | spec edge case: permission failures stay permission failures |
| `base_version == document.version_count` | (a) compared in Go against the already-loaded document, before any write; (b) enforced as `AND version_count = @base_version` on the `UPDATE` | FR-001, FR-002, FR-007 |
| `base_version` absent (`0`) or greater than current | Same predicate; no separate branch | FR-003 |
| Refusal creates nothing | Error returned from inside `txn.WithTxn` → rollback | FR-002 |

---

## What is deliberately not covered

Comments, reactions, follows, document status changes and access grants keep
last-write-wins. They are small independent writes where a lost update costs a click,
and none of them carries a base version. `UpdateDocumentStatus` in particular shares
the document row but not the rule, and does not bump `version_count`.
