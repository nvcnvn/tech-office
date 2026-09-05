# Phase 0 Research: Document Edit Conflict Protection

Every "NEEDS CLARIFICATION" raised while filling Technical Context is resolved below.
Nothing is left open.

---

## D1 — What is the base version token?

**Decision**: The existing `docs.document.version_count` column, exposed to clients
today as `Document.version_count` (field 12 of the `Document` message).

**Rationale**: The column is already maintained as the current version number, not
merely as a count:

- `CreateDocument` inserts the row with the column's default `1` and creates
  `document_version` number 1 in the same transaction (`internal/docs/logic.go:434`).
- `UpdateDocument`'s SQL sets `version_count = version_count + 1`
  (`database/scripts/docs.query.sql:38`) in the same statement and transaction as the
  `CreateVersion` insert that computes `MAX(version_number) + 1`.
- There is exactly one `INSERT INTO docs.document` in the whole codebase, and exactly
  two `CreateVersion` call sites, both of which are the two paths above.
- The spec confirms the two invariants that make count and maximum interchangeable:
  versions are never pruned and version numbers are never reused. `UpdateDocumentStatus`
  and the soft delete do not touch it. There is no restore-version RPC.

So `version_count == MAX(version_number)` holds by construction, the client already
receives it on every `GetDocument`, and FR-009 ("the reader must supply the version
number the reader is looking at") is already satisfied by shipped code. That makes
the base version a zero-cost token.

An existing reader already relies on this equality: `embed_logic.go:99,126` uses
`targetDoc.VersionCount` as the target document's latest *version number* when
snapshotting an embed and when computing staleness. This decision makes an
established assumption explicit rather than introducing a new one.

**Alternatives considered**:

- *A new `current_version_number` column.* Rejected: a migration, a backfill and a
  second thing to keep in step with `version_count`, in exchange for a better name.
- *An opaque revision token or a content hash.* Rejected: new state, new generation
  and comparison code, and it cannot answer "which version should I reload?" without
  a lookup. The spec's own assumptions reject it for the same reason.
- *`updated_at` as the token.* Rejected: a timestamp is not monotonic under clock
  adjustment, has resolution limits under a fast double-save, and cannot name a
  version to reload.
- *Renaming `version_count` to `current_version_number` across DB, proto and clients.*
  Rejected as churn: a migration plus five code sites for zero behavioural change.
  Instead the proto field gains a comment stating that it is the current version
  number and why count and maximum coincide.

[ASSUMPTION: `version_count` is reused as the concurrency token rather than a new
column being added, on the strength of the invariants above. The proto comment is
what keeps a future change from breaking the equality silently; a pruning or restore
feature would have to revisit this decision.]

---

## D2 — Where does the compare-and-swap happen, and is it atomic?

**Decision**: In the `UpdateDocument` SQL statement, as an extra predicate:

```sql
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE
  AND version_count = @base_version
```

Zero rows updated (sqlc `:one` surfaces this as `pgx.ErrNoRows`) means conflict.

**Rationale**: FR-007 demands that of two updates racing from the same base version
exactly one succeeds. This predicate delivers it with no extra machinery:

- The first transaction's `UPDATE` takes a row lock and bumps `version_count`.
- The second transaction's `UPDATE` blocks on that lock. Under READ COMMITTED,
  PostgreSQL re-evaluates the `WHERE` against the *updated* row once the first
  transaction commits. `version_count` no longer matches, so zero rows are updated.
- The refusal propagates as an error out of `txn.WithTxn`, so the transaction rolls
  back: no document write, no `document_version` row, no slug-history row, no
  follower notification. That is FR-002's "make no change and create no version".

It is also correct across backend instances (Constitution XI), because the
serialization point is the database row, not process memory.

A base version that is *higher* than the current one, or zero because the client
omitted the field, fails the same predicate and takes the same path. FR-002, FR-003
and the "omitted base version" edge case therefore need no separate code — which is
the point of putting the check in the `WHERE` clause rather than in Go.

**Alternatives considered**:

- *`SELECT ... FOR UPDATE` then compare in Go.* Rejected: an extra round trip on the
  common path to reach the same guarantee the `UPDATE` already gives.
- *`SERIALIZABLE` isolation.* Rejected: raises the cost of every document write and
  introduces serialization failures the caller must retry, to protect one statement.
- *An advisory lock or an application-level mutex.* Rejected: an advisory lock is a
  second thing to release correctly, and a process mutex is simply wrong on more than
  one instance.
- *A unique index on `(organization_id, document_id, version_number)` catching the
  duplicate insert.* This constraint already exists and would in fact catch the race,
  but it surfaces as an opaque constraint violation after the document body has
  already been overwritten in the same transaction — the diagnosis is worse and the
  ordering is wrong.

---

## D3 — Do we still check the base version in Go?

**Decision**: Yes, once, immediately after the `GetDocumentByID` that
`UpdateDocument` already performs, and **before** the slug-history write. The SQL
predicate stays as the authority; the Go check is the fast, well-diagnosed path.

**Rationale**: `UpdateDocument` already loads the current document to decide whether
the title changed. Comparing `req.BaseVersion` against `currentDoc.VersionCount`
right there costs nothing, produces the conflict before any speculative write, and
gives the conflicting author's details from a document already in hand. The rare
lost race — where the Go check passes because the reading transaction saw an older
snapshot, and the `UPDATE` then returns zero rows — maps to the same conflict error
after a fresh read of the current version. Both paths converge on one error value.

Ordering matters: today `CreateSlugHistory` runs *before* the `UPDATE`. Even though a
rollback would undo it, the base-version check is placed ahead of it so that a
conflict never speculatively writes.

---

## D4 — Which Connect error code?

**Decision**: `connect.CodeAborted` (HTTP 409).

**Rationale**: This is the canonical gRPC code for exactly this situation — the
status-code guidance names "concurrency issues such as sequencer check failures and
transaction aborts", and specifically directs `ABORTED` at a failed client-specified
test-and-set, which is what a base-version check is. It is distinct from every code
already returned by `DocumentServiceConnect.handleError`
(`NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_ARGUMENT`, `INTERNAL`), which is what
FR-004 requires: a client can recognise the conflict from the code alone, without
parsing prose.

**Alternatives considered**:

- *`FAILED_PRECONDITION`.* The house favourite elsewhere in this codebase, but the
  gRPC guidance distinguishes them precisely on retryability: `FAILED_PRECONDITION`
  means do not retry until system state is fixed; `ABORTED` means retry at a higher
  level. A conflict is resolved by reloading and re-saving — a higher-level retry.
  Using `FAILED_PRECONDITION` would also collide with the codes `collaboration`
  already returns on adjacent surfaces.
- *`ALREADY_EXISTS`.* Wrong meaning; nothing is being created twice.
- *A success response with a `conflict` flag.* Rejected: it makes every existing
  caller's happy path silently wrong until it is taught to read the flag, which is
  the failure mode this whole feature exists to remove.

---

## D5 — How is the conflict's payload carried?

**Decision**: A new error-detail message `rpc.v1.DocumentVersionConflict` in a new
`backend/rpc/v1/docs_error_details.proto`, attached with `connect.NewErrorDetail`.
Fields: `current_version_number`, `conflicting_author_name`,
`conflicting_changed_at`.

**Rationale**: Constitution X permits a custom detail message when the standard
`google.rpc` types cannot carry the information, and the repository already has the
precedent: `rpc/v1/iam_error_details.proto` defines `PinAuthErrorDetail` and
`SoleOwnerBlocksDeletion` for the same reason, with matching extractors in
`frontend/packages/apis/src/errorDetails.ts`. FR-005 and FR-006 call for a typed
integer, a name and a timestamp; forcing those through `ErrorInfo`'s
`map<string,string>` metadata or `PreconditionFailure`'s three free-text fields would
mean stringifying and re-parsing a version number and a timestamp on the client. The
custom message also passes the "use details only when they guide behaviour" bar:
without `current_version_number` a client cannot know what to reload, and without the
author and time the banner is a shrug.

The values come from queries that already exist: the current version number from the
freshly read document, and the author name and timestamp from `GetVersion`, whose SQL
already joins `organization.employee` and returns `author_name` and `created_at`.

**Alternatives considered**:

- *`ErrorInfo` with metadata strings.* Rejected: loses types across the boundary.
- *`PreconditionFailure`.* Rejected: pairs with `FAILED_PRECONDITION`, which D4 rules
  out, and its `type`/`subject`/`description` triple is prose, not data.
- *Adding the conflicting author's employee id.* Rejected as YAGNI: FR-006 asks who
  and when, and a name answers "go and talk to them". An id would only be needed to
  link to a profile or open a DM, which nothing in the spec asks for and which can be
  added later without breaking the message.

[ASSUMPTION: the detail carries the author's display name rather than their employee
id. Adding the id later is a non-breaking field addition, so the cheaper shape is
taken first.]

---

## D6 — Is disclosing the conflicting author's name a leak?

**Decision**: No. The detail is only ever produced on a request that has already
passed the `docs.update` permission check and the per-document `CheckAccess` write
check.

**Rationale**: The access check runs first inside the same transaction, so a caller
who may not edit the document gets `PERMISSION_DENIED` and never reaches the version
comparison — which is also the spec's stated edge case ("a permission failure is
reported as a permission failure, not as a conflict"). Anyone who does reach it holds
write access and can therefore already open the document's version history through
`DocumentVersionService.ListVersions`, where the same name and timestamp are listed.
The detail discloses nothing new, which is what the spec's assumption asserts.

---

## D7 — How does the web editor keep unsaved text through a conflict?

**Decision**: Keep the conflict entirely inside `DocumentEditor`'s existing
`saveMutation` error branch, and hold the base version in component state seeded from
`document.versionCount`. Additionally, guard the "Reset when document changes" effect
so it does not reapply server content while the person has unsaved edits.

**Rationale**: On a mutation error, TanStack Query's `onSuccess` does not run, so
`invalidateQueries` never fires and the editor's TipTap state is untouched — the
person's text stays in front of them for free. `DocumentEditor` already renders a
save-error `Alert`; the conflict simply renders a different, actionable one.

The guard is not optional. `DocumentView` fetches the document with
`staleTime: 30000` and TanStack Query's default `refetchOnWindowFocus: true`, while
`DocumentEditor`'s reset effect depends on `document.contentJson` and calls
`applyEditorContent`. So today, a person who edits in one tab, switches to another
tab and switches back can have their unsaved text silently replaced by whatever the
server returned. That is precisely the loss FR-010 forbids, it is reachable by the
two-tab scenario this feature exists for, and it is a root cause sitting in the same
component — so it is fixed here rather than worked around.

**Alternatives considered**:

- *A localStorage draft cache.* Rejected: new persistence, new staleness and cleanup
  rules, to protect text that never leaves the component in the first place.
- *Auto-reload and auto-reapply on conflict.* Rejected outright by FR-013 — the
  system must not merge, and by FR-010 — nothing is replaced without an action.
- *Blocking the editor behind a modal on conflict.* Rejected by acceptance scenario
  US2-3: the person must be able to decline to reload and keep working.

---

## D8 — What does the person do after the conflict?

**Decision**: The conflict banner offers two actions: **copy my changes** (writes the
editor's current text to the clipboard) and **load the current version** (refetches
the document, replaces editor content, and sets the base version to what was just
loaded, so the next save is accepted).

**Rationale**: SC-003 requires the person to get their change saved "within one
reload and one re-save, without leaving the document", and SC-002 requires their text
to remain available with no trip to version history. Reload is by definition
destructive to the unsaved draft — the spec's own recovery path is "reload the
current version and reapply their change" — so without a way to carry the text across
the reload, SC-003 is unreachable. `navigator.clipboard.writeText` over the markdown
the editor can already produce (`jsonToMarkdown`) is the smallest mechanism that
closes it, and it reuses a conversion the component performs today.

The reload button is labelled so that its effect on the unsaved draft is obvious
before it is pressed; pressing it is the "explicit action" FR-010 requires.

[ASSUMPTION: recovery is copy-then-reload-then-paste rather than a side-by-side diff
or a three-way merge view. The spec forbids automatic merging and rules a diff UI out
of the minimum fix; a diff view can be layered on later without changing the contract.]
