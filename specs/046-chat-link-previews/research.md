# Phase 0 Research: Link Previews In Chat

Decisions taken before design, each with the alternative it displaced. Everything here was
verified against the code on `main` as of 2026-09-04, not against the numbered specs.

---

## What already exists (verified, not assumed)

| Piece | Where | State |
|---|---|---|
| Preview endpoint | `backend/internal/linking/connect.go` → `GET /api/linking/preview?url=` | one link per request; 200 / 401 / 403 / 404 |
| Preview composition | `backend/internal/linking/preview.go` + `collaboration/task_logic.go` + `docs/logic.go` | seven providers, **none of which reads a database row** |
| Provider interface | `linking.PreviewProvider` | `Preview(target, canonicalURL)` — no `context`, no `DBTX`, no reader |
| Access evaluation | `linking.Service.resolveResourceStatus` | runs on the **resolve** path only; the preview handler calls `Resolve`, so a status is computed, but the preview body is composed from the URL either way |
| Web card | `apps/web/.../chat/components/MessageItem.tsx` (`CanonicalPreviewCard`) | renders; fetches its own preview in a `useEffect`, one request per message |
| Mobile card | `apps/mobile/src/components/chat/chat-message-body.tsx` | renders; one request per message via `fetchCanonicalPreview` |
| Link extraction | `packages/links/src/index.ts` | `extractCanonicalResourceLinks` already returns **all** links; both clients call `extractFirstCanonicalResourceLink` |
| Batched-lookup precedent | `ListTasksBySourceMessages` (feature 038) + `useMessageTaskLinks` | exactly the shape this feature needs, one layer over |

So the spec's Context Correction is confirmed: the renderers are fine, the content is
empty, only the first link previews, and the fetch is per message.

Two further findings the spec did not name:

- **Mobile shows a fabricated card on failure.** `getCanonicalLinkPreviewDisplay(preview,
  fallbackUrl)` falls back to `describeCanonicalResourceLink`, which builds
  `Task 0199c4f2…` from the URL alone. A reader denied access therefore sees a card
  today, which FR-015 forbids outright.
- **Document and calendar access checks are existence checks.** `resolveDocumentStatus`
  calls `GetDocumentByID` and `resolveCalendarEventStatus` calls `GetEvent`; neither
  consults `docs.document_access`/`visibility` or `calendar.event.visibility`. Filling the
  card with real content without fixing this would turn a weak resolve check into a real
  disclosure (FR-009).

---

## D1. Batch shape: replace the endpoint, do not add one beside it

**Decision**: `GET /api/linking/preview?url=` is **deleted** and replaced by
`POST /api/linking/previews` taking `{"urls": [...]}` and returning one item per input URL,
in input order. Cap 20 URLs per request; over the cap is a `400`, not a truncation.

**Rationale**: the project carries no backward-compatibility obligation and backend, web
and mobile release together, so two endpoints would only mean two code paths to keep
honest. Three callers exist (`MessageItem`, `chat-message-body`, `DocumentEditor`) and all
three are edited by this feature anyway. Rejecting over the cap rather than truncating
matches `ListTasksBySourceMessages`/`ErrTooManySourceMessages`, and since the clients hold
the same cap, a rejection means a client bug rather than a user action.

**Alternatives rejected**:
- *Keep the single-URL endpoint and call it N times in parallel.* Fails SC-005 by
  construction: 50 messages linking 5 resources still issues one request per link.
- *Make it a Connect RPC.* The linking surface is deliberately plain HTTP because
  `/api/linking/resolve` must answer unauthenticated link landings; splitting preview into
  proto while its two siblings stay HTTP buys type generation and costs coherence. The
  handler keeps using `AuthInterceptor.AuthenticateHTTPRequest`, as it does today.
- *Return a map keyed by URL.* An ordered array echoing the request URL is easier to
  render against and tolerates the same URL appearing twice in the request.

## D2. One `status` value for every failure

**Decision**: each item is `{"url", "status": "ok" | "unavailable", "preview"?}`. Access
denied, not found, deleted, wrong tenant, unauthenticated, malformed URL and unsupported
resource type all collapse to `unavailable` with no `preview` body.

**Rationale**: FR-010 requires that these be indistinguishable. The existing endpoint
answers 401/403/404 — three different answers to "may I see this?", which is precisely the
disclosure oracle FR-010 forbids. The clients treat every non-`ok` identically (raw link,
no card), so no client loses anything.

**Alternatives rejected**: keeping distinct statuses "for debugging" — the server log is
the place for that, and it already has `slog` with the reader and the target.

## D3. Reader entitlement is evaluated in SQL, per type, reusing the predicate that exists

**Decision**: every preview lookup is a batched query whose access predicate is
**copied from the query that already owns that rule**:

| Type | Predicate source |
|---|---|
| task | `ListTasksBySourceMessages` / `SearchTasks` (public project OR membership) |
| project | same predicate plus `owner_employee_id` (mirrors `resolveProjectStatus`) |
| document | `SearchDocuments` — the `COALESCE` precedence chain mirroring `CheckAccess`, deny-grant included |
| calendar event | `SearchEvents` — organiser OR attendee OR `team`/`org_wide` |
| chat channel / thread | `SearchChannels` — not private OR membership |

**Rationale**: a row the reader may not see is never loaded, so no Go branch can leak it,
and "which tasks may this reader see" keeps one definition. Feature 045 already paid the
cost of writing these predicates correctly; a second, hand-written interpretation in the
preview path is how the two drift.

**Alternatives rejected**: reusing `Service.resolveResourceStatus` per link (N+1 by
construction, and its document/event arms are the existence checks noted above).

## D4. Providers become batched, reader-scoped and domain-owned

**Decision**: `PreviewProvider` changes to

```go
type PreviewProvider interface {
    Handles(ResourceType) bool
    Preview(ctx context.Context, tx database.DBTX, reader PreviewReader, targets []PreviewTarget) (map[string]*LinkPreviewMetadata, error)
}
```

and the three stub providers that live in `internal/linking` today (project, chat channel,
chat thread, calendar event) **move into their own domains** — `internal/collaboration`,
`internal/chat`, `internal/calendar` — because they now read that domain's rows. The
aggregator groups the request's targets by provider and calls each provider once.

**Rationale**: Principle IV — a domain's rows are read through that domain's code.
`internal/linking` keeps no `.query.sql` of its own for previews, exactly as
`internal/search` keeps none. The batch is per provider, so a request holding a task link,
two document links and an event link costs three queries, not four.

**Alternatives rejected**:
- *Keep the pure `Preview(target, url)` signature and hydrate afterwards.* Then the
  hydration lives in `linking` and reads four schemas — the coupling Principle IV forbids.
- *Run providers concurrently.* Six providers × one query each, on a request that already
  waits on the network, is not where the latency is; concurrency here would add pool and
  cancellation complexity for no measured gain. If a request ever holds all six types and
  p95 suffers, the aggregator is the single place to add an `errgroup`.

## D5. Assignee names come from `organization` through a logic interface

**Decision**: the task provider resolves its assignee display names with one batched call
behind a locally-declared interface:

```go
// in internal/collaboration
type EmployeeNameLookup interface {
    ListEmployeeNames(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, ids []dbuuid.UUID) (map[dbuuid.UUID]string, error)
}
```

implemented by `internal/organization` over the existing `GetEmployeeCardsByIDs` query, and
injected in `cmd/server.go`.

**Rationale**: `rpcv1.Task` carries `assignee_employee_id`s and no names — the task detail
screen resolves them against a project member list it already holds, which a chat reader
does not have. Joining `collaboration.task_assignee` to `organization.employee` in one
statement would be the cross-schema join Principle IV forbids. A locally-declared interface
is the repository's existing idiom for this (`organization.CollaborationLogic`) and avoids
an import cycle.

**Alternatives rejected**: returning the assignee's UUID and letting the client resolve it
(a chat reader has no member list, and it would be a second round trip per card);
returning the assignee's email (leaks more than the card needs).

## D6. Multiple assignees collapse to "first + N"

**Decision**: the card names the earliest-assigned `role = 'assignee'` and, when there is
more than one, appends `+N`. No assignee → the assignee segment is omitted entirely.

[ASSUMPTION: FR-001 says "its current assignee", singular, but `collaboration.task_assignee`
permits many. Listing all of them would let one card grow without bound, which the display
cap exists to prevent. "First + N" is the smallest rendering that is never wrong.]

## D7. Structured fields over the wire; one shared formatter

**Decision**: `LinkPreviewMetadata` gains `identifier`, `stateName`, `stateCategory`,
`assigneeName`, `startTime`, `allDay`; `thumbnail` is **deleted**. Composition of the
card's supporting line happens once, in `packages/links`, in an extended
`buildCanonicalLinkPreviewDisplay` that returns `{ badge, title, lines[] }`.

**Rationale**: the reader's local time zone (FR-003) is only known on the client, so a
server-rendered "starts at" string would be wrong for anyone travelling. Putting the
formatter in the shared package rather than in each app is what keeps web and mobile cards
saying the same thing. `thumbnail` has never been populated and the spec puts images out of
scope, so it goes rather than lingering as a field nothing sets.

## D8. Reuse is client-side, session-scoped, and lives in `packages/apis`

**Decision**: one `fetchCanonicalPreviews(urls)` in a new `packages/apis/src/linking.ts`,
holding a module-level `Map<url, LinkPreviewItem>` for the session, de-duplicating both
in-flight and completed lookups, and cleared by `clearAuthToken()` on sign-out. The three
per-app fetch implementations are deleted.

**Rationale**: FR-021's "same link and reader" is exactly a session cache; keying by reader
is what makes it correct, and clearing on sign-out is how the reader is keyed without
storing an identity in the cache. `packages/apis` already owns the auth token and
`getRPCBaseUrl()`, so both apps get the same base-URL resolution instead of web's
`process.env.NEXT_PUBLIC_API_BASE_URL` and mobile's `API_BASE_URL` diverging.

**Alternatives rejected**:
- *A server-side cache.* A cache keyed by reader entitlement is a correctness hazard —
  entitlement changes (a project going private) would have to invalidate it — and this
  endpoint sees chat-scroll traffic, not scale traffic. The spec assumes the same.
- *TanStack Query.* Both clients have it, but the preview lookup is list-level and already
  keyed by a stable URL set; a plain Map is fewer moving parts and works identically in
  both apps. Reconsider if previews ever need refetch-on-focus.

## D9. Fetch at the list, render at the message

**Decision**: the list components own the lookup — `useCanonicalLinkPreviews(messages)` in
web's `VirtualizedMessageList`, and the equivalent in mobile's `[channelId].tsx` and
`thread/[messageId].tsx` — and pass a `Map<url, preview>` down to `MessageItem` /
`ChatMessageBody`. The message components stop fetching.

**Rationale**: this is `useMessageTaskLinks` one layer over, and it is what makes SC-005
true structurally rather than by luck: distinct URLs across the whole visible page are
requested once. It also gives FR-022 for free — the map starts empty and the message text
renders immediately.

## D10. Which link keeps its raw text

**Decision**: `removeCanonicalResourceLinksFromContent(text)` becomes
`removeCanonicalResourceLinksFromContent(text, urls)` and strips **only** the URLs that
produced a card. `describeCanonicalResourceLink` and the `fallbackUrl` argument of
`getCanonicalLinkPreviewDisplay` are deleted.

**Rationale**: FR-016 is per link, and the current all-or-nothing removal would hide a link
that has no card — leaving the reader with neither a card nor a link. Deleting
`describeCanonicalResourceLink` is what fixes the fabricated mobile card (FR-006, FR-015);
it exists only to invent a title from an identifier, which is the defect this feature was
opened for.

## D11. Pool choice

**Decision**: tenant-key → organization resolution stays on `AdminPool` (it answers a
pre-auth question about a global table). Every preview row read runs on **`TenantPool`**,
which `linking.Service` does not have today and gains in `cmd/server.go`.

**Rationale**: Principle I — user-facing reads belong on the tenant pool, and previews are
now strictly authenticated (no principal → every item `unavailable`, before any row is
read). `TenantPool`'s `BeforeAcquire` requires an org id in the context, which the
handler's `AuthenticateHTTPRequest` has already put there.

## D12. Scope held at the line the spec drew

Not built, deliberately: external URL unfurling; thumbnails; composer-time previews;
booking previews beyond today's generic card (no per-reader row to read); message-anchor
(`message`) and `workspace` previews (no resource of their own to describe). Mobile card
colours stay the hard-coded palette used by every other component in
`components/chat/` — this feature is not the place to introduce a mobile theme layer.

[ASSUMPTION: FR-002's "space" is `docs.document.parent_document_id`. There is no space
entity in `docs`; documents nest. A root document's supporting line names the workspace
rather than inventing a container.]

## D13. Known drift D53 is inherited, not fixed here

An event preview names the event correctly but, on web, the canonical route
`/workspace/calendar/{eventId}` has no page (drift register D53). The card therefore uses
the web **fallback** destination `/workspace/calendar`, which is what FR-017 already asks
for when the client cannot route to the resource. Building a web event detail page is a
calendar change and stays out of this feature; D53 stays open.
