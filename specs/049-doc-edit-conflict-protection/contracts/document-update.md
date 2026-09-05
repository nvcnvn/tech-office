# Contract: `DocumentService.UpdateDocument`

The only RPC surface this feature changes. Everything else in `rpc/v1/document.proto`
is untouched, and no other RPC gains a base version.

---

## Request — breaking change

```proto
message UpdateDocumentRequest {
  string id = 1;
  string title = 2;
  string content_json = 3;
  string version_summary = 4;  // Optional commit message

  // The document's version_count as the editing session loaded it. Required: a save
  // whose base version is not the document's current version is refused as a conflict
  // rather than overwriting the newer content (feature 049). Omitting it sends 0,
  // which never matches, so an old or malfunctioning client cannot opt back into
  // last-write-wins.
  int32 base_version = 5;
}
```

`Document.version_count` (field 12, already returned by `GetDocument`,
`CreateDocument` and `UpdateDocument`) gains a comment recording that it is the
document's current version number — versions are never pruned and never renumbered,
so the count and the highest version number are the same value.

The response message is unchanged; `new_version_number` on a successful save is the
base version for that session's next save.

## Success

Unchanged from today when `base_version` is current: content and title written, a new
version created, embeds synced, slug history written on a rename, followers notified,
`version_count` incremented by one (FR-008).

## Conflict

| | |
|---|---|
| **Code** | `ABORTED` (Connect `CodeAborted`, HTTP 409) |
| **Message** | Names the current version and the author, e.g. `document changed since it was loaded (now at version 6, saved by Mai Tran)` |
| **Detail** | exactly one `rpc.v1.DocumentVersionConflict` (see [docs_error_details.proto](./docs_error_details.proto)) |
| **Side effects** | none — the transaction is rolled back, so no document write, no version, no slug-history row, no notification |

Raised when `base_version` differs from the document's current `version_count` for
any reason: it is behind (the ordinary case), ahead (a version that does not exist),
or zero (omitted).

## Other outcomes — unchanged, and distinguishable

| Situation | Code | Detail |
|---|---|---|
| Document missing or deleted | `NOT_FOUND` | none |
| Caller lacks `docs.update`, or lacks write access to this document | `PERMISSION_DENIED` | none |
| Malformed id, depth or parent | `INVALID_ARGUMENT` | none |
| Anything else | `INTERNAL` | none |

The access check runs before the version check, so a caller who may not edit the
document is told so and is never shown a conflict.

Four distinct codes plus a typed detail is what lets a client tell "someone else
saved" from "you were logged out" from "the network dropped" without reading prose
(FR-004).

---

## Client contract

**`frontend/packages/apis/src/docs.ts`**

```ts
export interface UpdateDocumentParams {
	id: string;
	baseVersion: number;   // required — the version_count this session loaded
	title?: string;
	contentJson?: string;
	versionSummary?: string;
}
```

**`frontend/packages/apis/src/errorDetails.ts`** — a new extractor beside the
existing ones, returning `null` when the error is not a conflict, so a caller can
tell a conflict from an ordinary save failure with one call:

```ts
export interface DocumentVersionConflictDetail {
	currentVersionNumber: number;
	conflictingAuthorName: string;
	conflictingChangedAt: Date | null;
}

export function extractDocumentVersionConflict(
	error: unknown
): DocumentVersionConflictDetail | null;
```

**Callers to update in the same change set** (the contract is breaking by design):

- `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` — the only
  production caller of `updateDocument`, used by the docs page and by both task
  description panels.
- `frontend/apps/web/e2e/helpers/api.ts` — `updateDocument` test helper.
- `backend/integration/helper_test.go` — `testWorld.updateDocument` helper.
- `backend/integration/collaboration_ritual_procedure_test.go` — direct request
  construction.

Nothing under `frontend/apps/mobile` calls `UpdateDocument`; documents are read-only
there, so mobile needs no change.

---

## SQL contract

`backend/database/scripts/docs.query.sql`, `-- name: UpdateDocument :one` gains one
predicate:

```sql
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE
  AND version_count = @base_version
```

Zero rows updated is the conflict signal. Tenancy is unaffected: `organization_id`
stays the leading predicate and no join is added.
