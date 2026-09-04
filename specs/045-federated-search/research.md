# Phase 0 Research: Server-Side Federated Search

Every `NEEDS CLARIFICATION` raised while filling the Technical Context is resolved below.
This session ran unattended, so each open question was answered with the option a senior
engineer following this repository's conventions would pick, and each is recorded as an
`[ASSUMPTION: ...]` so it can be overturned on review.

---

## R1. Where does the fan-out live?

**Decision**: A new `SearchService` in `backend/rpc/v1/search.proto`, implemented in a new
`backend/internal/search` package that owns **no SQL** and depends on the six domains'
logic-layer interfaces.

**Rationale**: Principle IV forbids reaching into another domain's tables. Each of the
eight sources already has a logic-layer search method (or gains one, for work items), and
each of those methods is where its access rule lives. A federated searcher that called SQL
directly would copy six access rules into a seventh place — precisely the failure mode the
spec's first assumption rules out. Making `internal/search` a pure orchestrator means the
access rule for documents has exactly one implementation, used by both
`DocumentService.SearchDocuments` and `SearchService.Search`.

**Alternatives considered**:

- *Extend an existing service* (e.g. put `Search` on `OrganizationService`). Rejected: the
  RPC touches six domains, so hanging it off one of them makes that domain's package import
  the other five and inverts the dependency direction for no gain.
- *Keep the fan-out on the client and just add four more calls.* Rejected outright by
  FR-001/FR-002: ranking and per-source capping cannot be done consistently on two
  independently-written clients, and SC-007 requires identical ordering. It also multiplies
  round-trips from four to eight on a phone.
- *A denormalised cross-domain search index* (a `search.document` table fed by triggers or
  a job). Rejected by the spec's own assumption and by Principle V: it duplicates six access
  rules into one table, needs invalidation on every write in six domains, and introduces a
  window where search disagrees with the truth. Revisit only if measured fan-out latency
  misses SC-004.

---

## R2. Transaction handling across a concurrent fan-out

**Decision**: The connect handler does **not** open a transaction. It passes
`s.TenantPool` (which satisfies `database.DBTX`) to each source, and each source runs in
its own goroutine with its own `context.WithTimeout`.

**Rationale**: `pgx` transactions are explicitly not safe for concurrent use — eight
goroutines sharing one `pgx.Tx` interleave protocol frames on a single connection and
produce wrong or corrupt results. `*pgxpool.Pool` is concurrency-safe and hands each
goroutine its own connection. Search is a read-only operation with no cross-source
consistency requirement: nobody is harmed if the document source sees a document created a
millisecond after the message source ran.

**Alternatives considered**:

- *One transaction, eight sequential calls.* Correct, but latency becomes the sum of eight
  source latencies instead of the maximum of them, which cannot meet SC-004, and one slow
  source blocks the entire search, which FR-005 forbids.
- *Eight transactions, one per goroutine.* Works, but a `BEGIN`/`COMMIT` round-trip per
  source for a pure read is pure overhead. Rejected under Principle V.

This is the one place the plan departs from the usual `txn.WithTxn` shape, and it is
recorded in the plan's Complexity Tracking table.

---

## R3. Per-source time budget and the overall deadline

**Decision**: 800 ms per source, 900 ms overall. A source that misses its deadline is
reported `SOURCE_STATUS_UNAVAILABLE` and the search returns with everything else.

**Rationale**: SC-004 sets a 1 s p95 for the whole search as the caller experiences it.
Because the sources are concurrent, the handler's floor is the slowest single source plus
merge time (microseconds). 800 ms leaves ~200 ms of headroom inside the 1 s target for
transport, JSON/proto encoding and client render, and is far above the tens of milliseconds
an indexed PGroonga or trigram lookup takes on a realistic SMB workspace.

**[ASSUMPTION: 800 ms / 900 ms chosen as the round numbers that fit inside SC-004's 1 s
budget with room for transport; they are constants in `internal/search`, so tuning them
later is a one-line change and needs no contract change.]**

**Alternatives considered**: a per-source budget derived from a rolling latency measurement.
Rejected under Principle V and XI — it needs shared state across instances to be meaningful,
and there is no evidence yet that a fixed budget is wrong.

---

## R4. How eight incomparable relevance scores become one ordered list

**Decision**: **Round-robin by within-source rank**, with a fixed source priority breaking
ties. Sort key, ascending:

```
(rank_within_source, source_priority, kind, id)
```

Source priority is the fixed order: `person, channel, document, work_item, event, file,
department, message`.

**Rationale**: The four matchers in play produce numbers on four different scales —
`similarity()` (trigram, 0–1), `pgroonga_score()` (unbounded, corpus-dependent), and
`to_tsvector` rank. Comparing them directly is meaningless, which is why the spec declines
to. Round-robin by rank is deterministic (identical query + identical data ⇒ identical
order, SC-007), needs no shared scale, and *directly* satisfies SC-006: every source's
best hit appears before any source's second-best hit, so one matching document sits inside
the first eight rows even against a hundred matching messages. The tie-break chain ends in
`id`, so the order is total and stable.

Messages are last in the priority order because they are the noisiest source and the least
likely to be the thing someone typed a *name* to find; people are first because a name
typed into a search box is most often a person's.

**Alternatives considered**:

- *Normalise scores per source* (e.g. min-max within the returned page). Rejected: a page
  of one hit normalises to 1.0 and outranks a page of fifty good hits; it manufactures a
  common scale that does not exist.
- *Interleave by a fixed quota per source* (3 people, 3 documents, …). Rejected: it is
  round-robin with extra steps, and it fixes the *shape* of the list even when only one
  source matched.
- *Order by recency across sources.* Rejected: `updated_at` is available everywhere but
  answers a different question — SC-001 is about finding a thing by its name, not the most
  recently touched thing.

---

## R5. Bounding the answer (FR-014, FR-016)

**Decision**: mixed list — `limit` defaults to 40, max 80, **capped at 5 hits per source**.
Narrowed list (a `kind_filter` is set) — `limit` defaults to 20, max 50, one source only.

**Rationale**: 8 sources × 5 = 40, so a query matching everywhere fills the default mixed
page exactly and no source can crowd another out. The narrowed list at 20 is four times
deeper than the mixed list's 5, which is what FR-015 and US4 acceptance scenario 1 require
("more of them are listed than in the mixed view"). The hard maxima make FR-016
unconditional: no query, however crafted, returns an unbounded page.

**[ASSUMPTION: 5 / 40 / 80 and 20 / 50 chosen to make "eight sources fill one default page"
arithmetic exact while leaving the narrowed list visibly deeper; these are constants in
`internal/search`, not part of the wire contract.]**

---

## R6. Making document search access-scoped without a second access rule

**Decision**: Add an access predicate to the existing `SearchDocuments` query that mirrors
`documentLogicImpl.CheckAccess` **exactly**, including its precedence, and change the logic
signature to take `employeeID`. `DocumentService.SearchDocuments` gets the fix too.

**Rationale**: This is the root-cause fix. Guarding only the new federated path would leave
`DocumentService.SearchDocuments` — the procedure chooser in feature 043, among others —
still returning every document in the organization. Fixing the shared query is both the
smaller diff and the correct one. It closes the widest half of D49.

The precedence in `CheckAccess` is load-bearing and easy to get subtly wrong, so it is
restated as SQL in [data-model.md](data-model.md#document-access-predicate) and asserted
directly by the integration scenarios: an explicit `access_level = 'none'` employee grant
is a **deny that overrides** a department grant and overrides `visibility = 'public'`.

**Alternatives considered**:

- *Post-filter the search results with `CheckAccess` per row.* Rejected by the spec's second
  assumption and by arithmetic: it issues N+1 queries and returns short, unpredictable
  pages, because a page of 20 might filter down to 2.
- *Also fix the document tree listings* (`ListRootDocuments`, `ListChildDocuments`).
  Rejected as out of scope by the spec: it changes what every person sees in the docs
  sidebar and is a change in its own right. D49 is narrowed to cover only the tree (FR-024).

---

## R7. Making event search honour visibility

**Decision**: Add `organizer OR attendee OR visibility IN ('team','org_wide')` to
`SearchEvents` — the identical predicate `ListEventsForOrg` and `ListEventsForEmployee`
already ship between them — and pass the caller's employee id in. Cancelled events are
already excluded by `cancelled_at IS NULL`.

**Rationale**: Reusing a shipped predicate means there is one interpretation of the
`visibility` column rather than two. The `personal_shared` value deliberately falls outside
the org-wide arm: a personal-shared event is visible to its organiser and attendees only,
which is what the column name means and what the existing listing does.

**Alternatives considered**: inventing a broader rule for search (e.g. "anything not
`private`"). Rejected: it would make `personal_shared` mean two different things depending
on which screen you are on, which is how a visibility column stops being trusted.

---

## R8. Full-text matching for events, and the missing indexes

**Decision**: Switch `SearchEvents` from `to_tsvector('simple', …) @@ websearch_to_tsquery`
to PGroonga `&@~`, and add three indexes:

| Index | Table | Reason |
|---|---|---|
| `idx_event_pgroonga` | `calendar.event (title, description)` | `SearchEvents` is currently an unindexed sequential scan over every event in the database |
| `idx_file_metadata_filename_pgroonga` | `files.file_metadata (original_filename)` | `SearchFilesByNameAndContent` matches `original_filename &@~` with no index backing it |
| — | `collaboration.task (title)` | **already exists** (`idx_task_title_pgroonga`); no migration needed |

**Rationale**: PGroonga is the house multilingual matcher — messages, documents, file
content and task titles all already use it, and it is what makes SC-008 (Vietnamese titles)
work the same way in every source. `to_tsvector('simple')` neither stems nor segments and,
more importantly here, is not indexed at all, so every calendar search scans the table.
Leaving two of eight sources on sequential scans is the most likely single cause of missing
SC-004.

**Alternatives considered**: adding a GIN `to_tsvector` expression index to keep the current
matcher. Rejected: it keeps a second matcher in the system for no benefit and answers
Vietnamese queries worse than the one already installed.

---

## R9. Cross-project work-item search, which does not exist today

**Decision**: A new `SearchTasks` query in `collaboration.query.sql` and a matching
`SearchTasks` logic method. It matches `t.title &@~ @query` using the existing
`idx_task_title_pgroonga`, joins `collaboration.project` (same schema, so Principle IV is
satisfied) for the project name/key on the row, and gates on the project-access predicate
copied from `ListTasksBySourceMessages`: `p.visibility = 'public' OR EXISTS(project_membership)`.

It excludes `t.is_deleted`, `p.is_archived` (spec edge case), and returns `t.task_kind` so
the row can say whether it is a task or a ritual run.

**Rationale**: `ListTasksRequest` has a `search_query` field, but nothing in
`collaboration.query.sql` reads it — the field is dead, and `ListTasks` is single-project
anyway. There is genuinely nothing to reuse, so this is the one new query the feature adds.
Reusing the *access predicate* from `ListTasksBySourceMessages` keeps the project
visibility rule single-sourced even though the query is new.

`ListTasksRequest.search_query` is left alone rather than wired up: no caller sets it, and
adding a second, single-project title search is not what any story asks for. **[ASSUMPTION:
the dead `search_query` field is out of scope for this feature; removing it is a small
independent cleanup.]**

---

## R10. Per-source permission gating without failing the whole search

**Decision**: `Search` declares `allow_unauthenticated: false` with an **empty**
`required_permissions` — the constitution's deliberate "any authenticated caller". The
connect layer reads `interceptor.UserPermissionsFromContext`, builds the set of sources the
caller may search, and reports the rest as `SOURCE_STATUS_NOT_PERMITTED` without querying
them.

Source → permission, all of them already in the catalogue:

| Source | Permission |
|---|---|
| person | `org.searchEmployees` |
| department | `org.searchDepartments` |
| channel, message | `chat.search` |
| document | `docs.view` |
| file | `files.search` |
| work item | `collab.viewTask` |
| event | *(none — `CalendarService.SearchEvents` is any-authenticated today)* |

**Rationale**: FR-012 requires a caller lacking a source's permission to see that source as
*skipped*, not as a failure, and requires the search as a whole to succeed. Declaring any
one of the seven permissions on the RPC would deny the whole search to somebody entitled to
seven of the eight sources. Gating in the connect layer keeps the check where Principle III
puts lightweight authorization while letting the response report it per source.

No new permission id is introduced, and in particular **no `calendar.search` is invented**:
event search is any-authenticated today, the events themselves are visibility-filtered per
row (R7), and adding a permission would be a scope change nobody asked for (Principle V).
**[ASSUMPTION: events are therefore never reported `NOT_PERMITTED`; if calendar later gains
a view permission, adding it here is a one-line map entry.]**

---

## R11. What a result must carry so a client can open it without a second call

**Decision**: A flat `SearchTarget` message with one named field per identifier kind. The
client switches on `SearchHit.kind` and reads the fields that kind populates.

| Kind | Fields used | Web route | Mobile route |
|---|---|---|---|
| PERSON | `employee_id` | `/workspace/organization` | opens/creates the DM via `CreateOrGetDirectMessage` |
| DEPARTMENT | `department_id` | `/workspace/organization` | *(informational — mobile has no department screen)* |
| CHANNEL | `channel_id` | `/workspace/chat` | `/(app)/(chat)/{channelId}` |
| MESSAGE | `channel_id`, `message_id` | `/workspace/chat` | `/(app)/(chat)/{channelId}` with `highlightedMessageId` |
| DOCUMENT | `document_slug` | `/workspace/docs/{slug}` | `/(app)/(more)/docs/{slug}` |
| FILE | `file_id` | `/workspace/files` | `/(app)/(more)/files/{fileId}` *(new screen)* |
| WORK_ITEM | `project_id`, `task_id` | `/workspace/projects/{projectId}/tasks/{taskId}` | `/(app)/(tasks)/{projectId}/task/{taskId}` |
| EVENT | `event_id` | `/workspace/calendar/{eventId}` | `/(app)/(calendar)/{eventId}` |

**Rationale**: The document row carries a **slug, not an id**, because both document
viewers route by slug — a search result that returned only the id would push
`/docs/undefined`, which is a bug this repository has already been bitten by. The work-item
row carries `project_id` because both task routes are project-scoped; without it every tap
would need a `GetTask` round-trip first, which FR-003 forbids.

Named fields rather than a `map<string,string>` of magic keys keeps the contract
self-documenting and generated-typed on both platforms (Principle VIII).

**Alternatives considered**:

- *Return a canonical link (`/o/{tenant}/r/{type}/{id}`) per hit and let the clients resolve
  it.* Attractive, since `internal/linking` already owns the per-platform route table, but
  rejected on two counts: `linking` has no `file` resource type, and its document route uses
  the document **id** where both viewers expect a slug — so it would have to change anyway,
  and a search box making an HTTP `resolve` round-trip per tapped row is a second lookup
  (FR-003) on the slowest possible path.
- *A `map<string, string> ids` field.* Rejected under Principle VIII: string keys crossing
  three layers with no compile-time check is exactly what that principle exists to stop.

---

## R12. Mobile has nowhere to put a File row

**Decision**: Add `frontend/apps/mobile/src/app/(app)/(more)/files/[fileId].tsx` — a small
detail screen showing filename, size, context and validation status, with a Download/Share
action reusing the `getDownloadUrl` → `expo-sharing` flow the files list already implements.

**Rationale**: FR-017 says no row kind may be rendered without somewhere to go, and mobile
has only a paginated `files/index.tsx` — routing a search hit there would land the person on
a list that may not even contain the file they tapped. `GetFileMetadata` already exists, so
the screen is a thin read. It also gives FR-022 a natural home: a deleted file reports "this
file no longer exists" instead of a blank screen.

**Alternatives considered**: routing to `files/index.tsx?highlight={id}`. Rejected — the
list is paginated, so the highlight frequently is not on the page, and a highlight that
silently does nothing is worse than no navigation.

---

## R13. Recent items, and recents whose target has gone

**Decision**: Keep recents in device MMKV exactly as today, widen the stored record to all
eight kinds, and make a recent that fails to open report "this item is no longer available"
and remove itself from the list.

**Rationale**: FR-021 and FR-022. The spec's assumption keeps history device-local and
unsynchronised, so no server work is involved. Self-eviction on a failed open is the whole
of FR-022 and costs one `catch` branch — a recent that keeps offering a deleted document
every visit is the failure mode being fixed.

---

## R14. What "every source failed" looks like

**Decision**: If **no** source returned `SOURCE_STATUS_OK` *and at least one* was attempted,
the handler returns `connect.CodeUnavailable` with a message naming the failure. If sources
returned zero hits but succeeded, it is a normal empty response.

**Rationale**: US3 acceptance scenario 3 and SC-005. This is the one case where an error is
the honest answer — an empty list would tell the person their workspace contains nothing.
The distinction between "answered with nothing" and "could not answer" is exactly what
`SourceOutcome` exists for (FR-004), and the all-failed case is that distinction applied to
the whole response.

A caller permitted to search *nothing* (every source `NOT_PERMITTED`) is **not** an error —
it is a successful empty response, because nothing is broken (spec edge case: "a person
whose role denies them a whole source … it is not broken, it is not theirs").

---

## R15. Minimum query length

**Decision**: 2 characters, enforced on both clients (as today) **and** in the handler,
which returns `InvalidArgument` below it.

**Rationale**: The mobile screen already gates at `query.length >= 2` and the spec's edge
case says a one-character query shows recents rather than running a search. Enforcing it
server-side too stops a single-character query fanning out to eight sources — a trigram
search on one character matches most of the table. Client-side gating alone is a
performance guarantee that any caller can decline to honour.

**[ASSUMPTION: 2 characters preserves the existing client threshold rather than inventing a
new one; the handler enforces the same number so the guarantee holds for every caller.]**
