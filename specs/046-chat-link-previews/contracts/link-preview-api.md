# Contract: Batched Link Preview

Three contracts move together and ship as one change set: the HTTP endpoint, the Go
provider interface behind it, and the TypeScript surface both apps call. There is no
compatibility path — the single-URL endpoint is deleted (research D1).

---

## 1. HTTP — `POST /api/linking/previews`

Registered in `backend/internal/linking/connect.go` alongside `generate` and `resolve`.
Plain JSON, not Connect RPC, matching its two siblings.

**Deleted**: `GET /api/linking/preview?url=` and the `PreviewResponse` type.

### Request

```json
{ "urls": ["https://app.example.com/o/acme/r/task/0199…", "https://app.example.com/o/acme/r/document/0199…"] }
```

Authorization: `Bearer <jwt>` header, read by `AuthInterceptor.AuthenticateHTTPRequest`.
No `?token=` query fallback: unlike `resolve`, a preview is never the landing of a
navigation.

### Response — always `200` unless the request itself is malformed

```json
{
  "items": [
    {
      "url": "https://app.example.com/o/acme/r/task/0199…",
      "status": "ok",
      "preview": {
        "title": "Replace the walk-in freezer gasket",
        "resourceType": "task",
        "badge": "Task",
        "href": "https://app.example.com/o/acme/r/task/0199…",
        "identifier": "OPS-142",
        "stateName": "In progress",
        "stateCategory": "in_progress",
        "assigneeName": "Mai Anh Nguyen"
      }
    },
    { "url": "https://app.example.com/o/acme/r/document/0199…", "status": "unavailable" }
  ]
}
```

- One item per requested URL, **in request order**, echoing the URL as sent.
- `status` is `ok` or `unavailable`. Nothing else. Access denied, not found, deleted,
  cancelled, archived, another tenant's link, unauthenticated, malformed URL and
  unsupported resource type are all `unavailable` with no `preview` (FR-010).
- `preview` is present if and only if `status` is `ok`.
- A duplicate URL in the request yields a duplicate item; the reader is looked up once.

### Error responses

| Status | When | Body |
|---|---|---|
| `400` | body is not JSON, or `urls` is missing/empty | `{"error": "..."}` |
| `400` | `len(urls) > 20` (`linking.MaxPreviewURLsPerRequest`) | `{"error": "too many urls"}` |
| `405` | method is not `POST` | — |

An unauthenticated request is **not** an error: it returns `200` with every item
`unavailable`, so a client cannot tell "you are signed out" from "you may not see this"
(FR-010) and the render path stays uniform.

### Preview object

| Field | Type | Present for |
|---|---|---|
| `title` | string | always |
| `resourceType` | string enum | always — `task` `document` `calendar` `project` `chat` `thread` `booking` |
| `badge` | string | always |
| `href` | string | always |
| `subtitle` | string | document, project, thread |
| `identifier` | string | task, project |
| `stateName`, `stateCategory` | string | task |
| `assigneeName` | string | task, when the task has an assignee |
| `startTime` | RFC3339 string | calendar |
| `allDay` | bool | calendar |

`thumbnail` is removed from `LinkPreviewMetadata` entirely.

---

## 2. Go — `linking.PreviewProvider`

```go
// PreviewTarget is one link the request asked about, already normalised.
type PreviewTarget struct {
    Key          string               // string(ResourceType) + "/" + ResourceID
    Target       CanonicalLinkTarget
    CanonicalURL string
}

// PreviewReader is who is asking. A preview is only ever composed for a reader whose
// organization matches the link's tenant.
type PreviewReader struct {
    EmployeeID     dbuuid.UUID
    OrganizationID dbuuid.UUID
}

type PreviewProvider interface {
    // Handles reports whether this provider answers for a resource type.
    Handles(resourceType ResourceType) bool

    // Preview resolves every target of its own types in one call. A target the reader may
    // not see is simply absent from the returned map — the provider never reports why.
    Preview(ctx context.Context, tx database.DBTX, reader PreviewReader, targets []PreviewTarget) (map[string]*LinkPreviewMetadata, error)
}
```

**Aggregator** (`linking.PreviewAggregator`) groups the request's targets by the first
provider that `Handles` their type, calls each provider once, and merges by `Key`. A
provider returning an error contributes nothing and is logged at `slog.WarnContext`; the
other providers' results still render (FR-023).

**Ownership after this change** — a provider lives in the domain whose rows it reads
(Principle IV):

| Provider | Package | Types |
|---|---|---|
| `NewTaskPreviewProvider(queries, employeeNames)` | `internal/collaboration` | `task` |
| `NewProjectPreviewProvider(queries)` | `internal/collaboration` | `project` |
| `NewDocumentPreviewProvider(queries)` | `internal/docs` | `document` |
| `NewEventPreviewProvider(queries)` | `internal/calendar` | `calendar` |
| `NewChatPreviewProvider(queries)` | `internal/chat` | `chat`, `thread` |
| `NewBookingPreviewProvider()` | `internal/linking` | `booking` — no row read |

`internal/linking` keeps no preview SQL of its own. The default "compose a title from the
URL" branch of `PreviewAggregator` is **deleted**: a target no provider resolves is
`unavailable`, not a card naming a UUID (FR-006).

Cross-domain name resolution, declared locally in `internal/collaboration` to avoid an
import cycle and implemented by `internal/organization` over `GetEmployeeCardsByIDs`:

```go
type EmployeeNameLookup interface {
    ListEmployeeNames(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, ids []dbuuid.UUID) (map[dbuuid.UUID]string, error)
}
```

### Handler order (FR-009, FR-012)

1. Decode; reject a malformed body or an over-cap list.
2. Authenticate. No principal → every item `unavailable`, **no database access**.
3. Normalise each URL; unparseable or unsupported → `unavailable`.
4. Resolve each distinct `tenantKey` → organization (`AdminPool`, global table).
5. Drop every target whose organization is not the reader's → `unavailable`.
6. Group the survivors by provider; run each once on `TenantPool`.
7. Assemble items in request order.

---

## 3. TypeScript

### `packages/apis/src/linking.ts` (new)

```ts
export const MAX_PREVIEW_URLS_PER_REQUEST = 20;

export interface LinkPreviewItem {
  url: string;
  status: 'ok' | 'unavailable';
  preview?: CanonicalLinkPreview;
}

/**
 * Resolves previews for a set of canonical links, one request for the whole set.
 * De-duplicates against a session cache and against in-flight lookups, so a resource
 * linked from twenty messages is looked up once (FR-021). Never throws: a failed lookup
 * resolves to an empty map, which renders as raw links.
 */
export function fetchCanonicalPreviews(urls: string[]): Promise<Map<string, CanonicalLinkPreview>>;

/** Called by clearAuthToken() on sign-out; the cache is reader-scoped by lifetime. */
export function clearCanonicalPreviewCache(): void;
```

Deleted with it: the inline `fetch` in `MessageItem.tsx`, `fetchCanonicalPreview` in
`apps/mobile/src/lib/canonical-links.ts`, and the per-URL `Promise.all` loop in
`DocumentEditor.tsx`.

### `packages/links/src/index.ts` (changed)

```ts
export const MAX_PREVIEW_CARDS = 3;

export interface CanonicalLinkPreview {
  title: string;
  subtitle?: string;
  resourceType: CanonicalResourceType;
  href: string;
  badge?: string;
  identifier?: string;
  stateName?: string;
  stateCategory?: string;
  assigneeName?: string;
  startTime?: string;   // RFC3339
  allDay?: boolean;
}

export interface CanonicalLinkPreviewDisplay {
  badge: string;
  title: string;
  /** Supporting lines, already composed. At most two, already truncated. */
  lines: string[];
  href: string;
}

/** The one place a card's text is composed, so web and mobile cards always agree. */
export function buildCanonicalLinkPreviewDisplay(preview: CanonicalLinkPreview): CanonicalLinkPreviewDisplay;

/** Strips only the URLs that produced a card; every other link keeps its raw text (FR-016). */
export function removeCanonicalResourceLinksFromContent(rawContent: string, urls: string[]): string;
```

Deleted: `describeCanonicalResourceLink`, `getCanonicalLinkPreviewDisplay`,
`CanonicalPreviewResponse`, and the `thumbnail` field. They exist only to fabricate a card
from a URL, which is the defect this feature closes.

`buildCanonicalLinkPreviewDisplay` composition, by type:

| Type | title | lines |
|---|---|---|
| task | task title | `["OPS-142 · In progress · Mai Anh Nguyen"]` — segments omitted when absent |
| document | document title | `["in Operations Handbook"]`, or `["in Workspace docs"]` at the root |
| calendar | event title | `[localised start]` — `Intl.DateTimeFormat`, date only when `allDay` |
| project | project name | `["OPS"]` |
| chat | `#display-name` | `[]` |
| thread | `#display-name` | `["Thread"]` |
| booking | `"Booking"` | `["Schedule a meeting"]` |

### List components

```ts
// web: apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx
// mobile: apps/mobile/src/app/(app)/(chat)/[channelId].tsx and .../thread/[messageId].tsx
function useCanonicalLinkPreviews(messages: { messageText: string }[]): Map<string, CanonicalLinkPreview>;
```

Collects distinct canonical URLs across the rendered page (cap `MAX_PREVIEW_LOOKUP = 20`),
issues one request, returns a map keyed by URL. `MessageItem` and `ChatMessageBody` take
the map as a prop and fetch nothing (FR-020, FR-022, SC-005).
