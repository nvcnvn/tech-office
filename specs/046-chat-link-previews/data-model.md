# Data Model: Link Previews In Chat

**No schema change.** No table, column, index or migration. Every entity below is derived
at request time from rows that already exist, and nothing is written. The only persistent
artefacts this feature adds are six read queries.

---

## Entities

### Link preview (derived, per reader, per request)

The wire shape, `linking.LinkPreviewMetadata`, after this feature:

| Field | Type | Set for | Notes |
|---|---|---|---|
| `title` | string | all | the resource's own title; never a UUID (FR-006) |
| `subtitle` | string | document, project, thread | plain supporting line where the type has one |
| `resourceType` | enum | all | `task` · `document` · `calendar` · `project` · `chat` · `thread` · `booking` (FR-008) |
| `badge` | string | all | display label for the type |
| `href` | string | all | canonical URL, the card's destination |
| `identifier` | string | task, project | `PROJ-12`, project key — the human-readable id (FR-001, FR-006) |
| `stateName` | string | task | `project_state.name` |
| `stateCategory` | string | task | `project_state.category`, for a client-side chip |
| `assigneeName` | string | task | earliest `role = 'assignee'`, `+N` appended by the client formatter (D6) |
| `startTime` | RFC3339 string | calendar | rendered in the reader's local zone by the client (FR-003) |
| `allDay` | bool | calendar | suppresses the time part |

Removed: `thumbnail` (never populated; images are out of scope).

**Title fallback chain (FR-006)**, applied server-side in this order:
resource title → resource identifier (`task.identifier`, `project.key`,
`channel.title_slug`) → the resource type name alone. A UUID is never a candidate.

### Preview item (the unit of the batch response)

`{ url, status, preview? }` where `status ∈ {ok, unavailable}` — one item per requested
URL, in request order. See [contracts/link-preview-api.md](contracts/link-preview-api.md).

### Preview reader

`{ employeeID, organizationID }` from the authenticated request context. Not a stored
entity; it is the second half of every access predicate below. No principal, or an
organization other than the link's tenant, means every item is `unavailable` before any row
is read (FR-009, FR-012).

---

## Per-type content and access rules

Column names are as they exist in `backend/database/scripts/schema.sql`. The exact SQL is
in [contracts/preview.query.sql](contracts/preview.query.sql).

### Task — `collaboration.task`

- **Content**: `title`, `identifier`, `project_state.name`/`.category` via `state_id`,
  earliest `task_assignee` with `role = 'assignee'` (+ count for `+N`).
- **Excluded**: `is_deleted = TRUE`.
- **Access**: project `visibility = 'public'` OR a `project_membership` row for the reader
  — the predicate `ListTasksBySourceMessages` and `SearchTasks` already share.
- **Cross-domain**: assignee display name via `EmployeeNameLookup` (D5), never a join.

### Project — `collaboration.project`

- **Content**: `name`; `key` as `identifier` and as the supporting line.
- **Access**: `visibility <> 'private'` OR `owner_employee_id = reader` OR a
  `project_membership` row — mirrors `Service.resolveProjectStatus`.

### Document — `docs.document`

- **Content**: `title`; supporting line is the parent document's `title` via
  `parent_document_id`, or the workspace when the document is a root.
- **Excluded**: `is_deleted = TRUE`.
- **Access**: the `COALESCE` precedence chain from `SearchDocuments` — owner, then explicit
  employee grant (including an explicit `none`, which is a deny that stops the chain), then
  the highest inherited department grant, then `visibility = 'public'`. The parent's title
  is only read when the **child** is visible; a visible child inside an invisible parent
  still names its parent, which is what "which space is this in" means.

### Calendar event — `calendar.event`

- **Content**: `title`, `start_time`, `all_day`.
- **Excluded**: `cancelled_at IS NOT NULL`.
- **Access**: `organizer_id = reader` OR an `attendee` row OR
  `visibility IN ('team','org_wide')` — the predicate from `SearchEvents`.

### Chat channel — `chat.channel`

- **Content**: `display_name` (fallback `title_slug`).
- **Excluded**: `is_archived = TRUE`; `channel_type = 'direct_message'` is previewable only
  to its members, which the access predicate already gives.
- **Access**: `is_private = FALSE` OR a `channel_membership` row — from `SearchChannels`.

### Chat thread — `chat.message` → `chat.channel`

- **Content**: the parent channel's `display_name`; badge `Thread` carries the
  "this is a thread" indication (FR-005).
- **Excluded**: `is_deleted = TRUE` on the root message; archived channels.
- **Access**: the channel predicate above, applied to the message's channel. The thread's
  resource id is its root message id, matching what `MessageItem`'s copy-link generates.
- **Recursion**: a thread or channel preview reads one row and never renders messages, so
  the "channel linked inside the channel being read" edge case is closed by construction.

### Booking — unchanged

Generic card, no row read. There is no per-reader booking record to describe.

---

## Bounds

| Bound | Value | Where |
|---|---|---|
| URLs per preview request | 20 | `linking.MaxPreviewURLsPerRequest`, mirrored as `MAX_PREVIEW_URLS_PER_REQUEST` in `packages/apis` |
| Distinct URLs looked up per rendered page | 20 | `MAX_PREVIEW_LOOKUP` in each list component |
| Cards rendered per message | 3 | `MAX_PREVIEW_CARDS` in `packages/links`, matching the existing task-chip cap |

Over the request bound is a `400`, not a truncation (D1). Over the per-message card cap,
the extra links stay raw clickable text (FR-013).

---

## Client-side state

| State | Lifetime | Keyed by |
|---|---|---|
| preview cache (`packages/apis/src/linking.ts`) | session; cleared by `clearAuthToken()` | canonical URL |
| in-flight de-duplication | until the request settles | canonical URL |
| `Map<url, preview>` held by a list component | the mounted list | canonical URL |

Nothing is persisted to disk on either client, and nothing is written to the message row:
previews are computed on read, so a message posted before this feature previews normally
and a card always reflects the resource's current state (FR-007).
