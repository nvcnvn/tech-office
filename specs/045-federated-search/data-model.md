# Phase 1 Data Model: Server-Side Federated Search

**No new tables.** The feature adds one wire contract, three indexes, one new query and
three changed queries. Everything else is orchestration over data that already exists.

---

## 1. Wire entities

These are the spec's Key Entities, made concrete. The authoritative definition is
[contracts/search.proto](contracts/search.proto); this section explains the fields and the
rules attached to them.

### `SearchRequest`

| Field | Type | Rules |
|---|---|---|
| `query` | string | Trimmed. **Minimum 2 characters** after trimming — shorter returns `InvalidArgument` (R15). Maximum 200 characters; longer is truncated rather than rejected. |
| `kind_filter` | `SearchKind` | `SEARCH_KIND_UNSPECIFIED` means the mixed list over all sources. Any other value narrows to that one source (FR-015). |
| `limit` | int32 | Mixed: default 40, max 80. Narrowed: default 20, max 50. Out-of-range values are clamped, not rejected. |

The request carries **no caller identity** — organization and employee come from the auth
context (Principle I), and every access decision follows from them.

### `SearchKind` (proto enum — the closed set from the spec)

`UNSPECIFIED`, `PERSON`, `DEPARTMENT`, `CHANNEL`, `MESSAGE`, `DOCUMENT`, `FILE`,
`WORK_ITEM`, `EVENT`. Adding a value is a change to this contract.

Generated into Go and TypeScript from one definition, so no source-name string crosses a
layer (Principle VIII).

### `SearchHit`

| Field | Type | Meaning |
|---|---|---|
| `kind` | `SearchKind` | the badge on the row |
| `title` | string | what the person typed the name of |
| `context_line` | string | one line saying **where it lives** — see the table below |
| `snippet` | string | optional matched-content excerpt; **empty for every kind whose content the caller may not read** |
| `rank` | int32 | 0-based position **within its own source**, as that source ranked it |
| `target` | `SearchTarget` | the identifiers needed to open it (FR-003) |

`context_line` per kind, so no client invents its own phrasing:

| Kind | `context_line` |
|---|---|
| PERSON | the person's email |
| DEPARTMENT | member count, e.g. `12 members` |
| CHANNEL | `Private channel` or `Channel` |
| MESSAGE | `in #{channel_name}` |
| DOCUMENT | `Document` |
| FILE | the upload context display name, e.g. `Engineering Team Chat` |
| WORK_ITEM | `{project_name} · Task` or `{project_name} · Ritual` (the spec's ritual-vs-task edge case) |
| EVENT | the formatted start date |

### `SearchTarget`

One flat message, one named field per identifier. Clients switch on `kind` and read the
fields that kind populates; see [research.md R11](research.md#r11-what-a-result-must-carry-so-a-client-can-open-it-without-a-second-call)
for the full route table.

```
employee_id · department_id · channel_id · message_id · document_slug ·
file_id · project_id · task_id · event_id
```

Two of these are load-bearing and easy to get wrong:

- **`document_slug`, not a document id** — both document viewers route by slug.
- **`project_id` alongside `task_id`** — both task routes are project-scoped, and FR-003
  forbids a second lookup to find the project.

### `SourceOutcome`

One per source, always eight entries, in the fixed source-priority order.

| Field | Type | Meaning |
|---|---|---|
| `kind` | `SearchKind` | which source |
| `status` | `SourceStatus` | `OK` · `UNAVAILABLE` · `NOT_PERMITTED` |
| `hit_count` | int32 | how many of that source's hits are in `hits` (post-cap) |
| `detail` | string | short, non-sensitive reason when not `OK` (`"timed out"`, `"missing permission docs.view"`) |

`OK` with `hit_count = 0` is "no documents match". `UNAVAILABLE` is "documents could not be
searched". Keeping those two apart is the whole of FR-004.

`NOT_PERMITTED` is **not** an error and never contributes to the all-failed check (R14).

---

## 2. Access predicates

These are the only genuinely new logic in the feature, and each one is asserted directly by
an integration scenario.

### Document access predicate

Mirrors `documentLogicImpl.CheckAccess` (`internal/docs/version_logic.go`) **including its
precedence**, which is load-bearing:

1. **owner** → access, unconditionally;
2. otherwise an **explicit employee grant**, if one exists — including `'none'`, which is a
   deny that stops the chain;
3. otherwise the **highest department grant** among the caller's departments, if any;
4. otherwise `visibility = 'public'` → access;
5. otherwise no access.

Steps 2 and 3 must *short-circuit*: an employee grant of `'none'` denies even when a
department grant says `write_update` and even when the document is `public`. A naive
`OR`-chain gets this wrong, which is why the predicate is written as a `COALESCE` over
scalar sub-selects rather than as disjunctions. Exact SQL in
[contracts/search.query.sql](contracts/search.query.sql).

Applies to `docs.SearchDocuments` for **every** caller, not just federated search (R6). It
closes the search half of drift D49; the tree listings keep their org scope and D49 narrows
to cover only them (FR-024).

### Calendar event visibility predicate

```
e.organizer_id = @employee_id
OR EXISTS (attendee row for @employee_id on this event)
OR e.visibility IN ('team', 'org_wide')
```

Byte-for-byte the rule `ListEventsForEmployee` and `ListEventsForOrg` already ship between
them, so `visibility` has one interpretation rather than two. `personal_shared` is
deliberately outside the third arm: it means organiser-and-attendees-only. `cancelled_at IS
NULL` already excludes cancelled events (spec edge case).

### Project access predicate for work items

Copied from `ListTasksBySourceMessages`:

```
p.visibility = 'public'
OR EXISTS (project_membership row for @employee_id on this project)
```

plus `t.is_deleted = FALSE` and `p.is_archived = FALSE` (the spec's archived-project edge
case). FR-009 additionally forbids *disclosing the existence* of unreadable items, so
`hit_count` counts only returned rows — there is no "and 40 more you cannot see".

### Unchanged access rules

Files (`far.context_id = ANY(caller's contexts)`), channels and messages (`is_private =
FALSE OR member`), people and departments (org-scoped by design) are reused exactly as they
are. FR-011 forbids changing what those return.

---

## 3. Schema changes

### New indexes — `20260905000001_search_indexes`

| Index | Definition | Why |
|---|---|---|
| `idx_event_pgroonga` | `ON calendar.event USING pgroonga (title, description)` | `SearchEvents` is an unindexed sequential scan today |
| `idx_file_metadata_filename_pgroonga` | `ON files.file_metadata USING pgroonga (original_filename)` | `SearchFilesByNameAndContent` matches `original_filename &@~` with nothing behind it |

`collaboration.task (title)` already has `idx_task_title_pgroonga`, and
`docs.document (title, content_text)` already has `idx_document_title_pgroonga` and
`idx_document_pgroonga`. No index is added for them.

Forward-only migration with a matching `.down.sql` that drops both.
`backend/database/scripts/schema.sql` is a **generated** snapshot and is regenerated from
the migrations, never hand-edited.

### Changed queries

| Query | File | Change |
|---|---|---|
| `SearchDocuments` | `docs.query.sql` | + `@employee_id` param, + access predicate |
| `SearchEvents` | `calendar.query.sql` | + `@employee_id` param, + visibility predicate, `to_tsvector` → PGroonga `&@~` |
| `SearchTasks` | `collaboration.query.sql` | **new** — cross-project title search with the project-access predicate |

All three are regenerated through `sqlc` (`make sqlc` / `sqlc generate`); no generated Go is
hand-edited.

---

## 4. Ranking, capping and determinism

Merge is a pure function of the eight per-source result slices. Sort ascending by:

```
(rank_within_source, source_priority, kind, id)
```

with `source_priority` the fixed order `person, channel, document, work_item, event, file,
department, message`.

Consequences worth stating because scenarios assert them:

- **Deterministic** — the key ends in `id`, so the order is total; the same query over the
  same data produces the same list on web and on mobile (FR-013, SC-007).
- **No source can crowd the first screen** — every source's rank-0 hit precedes every
  source's rank-1 hit, so one matching document sits within the first eight rows against a
  hundred matching messages (FR-014, SC-006).
- **Capping happens before merge**, at 5 per source in mixed mode, so the cap is a property
  of the answer and not of where the client stops scrolling.

Constants (`perSourceCapMixed = 5`, limits, deadlines) live in `internal/search`, not in the
wire contract, so tuning them is a one-line change.

---

## 5. State transitions

None. Search is a pure read: it creates, updates and deletes nothing, emits no events and
holds no state between requests (Principle XI). The only persisted state the feature touches
is the mobile **recent items** list, which lives in device MMKV, never on the server, and
whose only transitions are *append on open*, *evict on failed open* (FR-022) and *clear all*
(FR-021).
