# Workspace Shell & Navigation

The cross-cutting client experience: federated search, canonical cross-platform links, the
context rail, theme preferences, the feature tour, and the shape of the web and mobile
apps.

**Status date: 2026-09-12.** Supersedes specs 011, 012, 013, 027, 030, 031, 035, 039, 040, 041, 044, 045, 046, 047, 048, 050.

## Canonical resource links

One URL shape that works from an email, a Slack paste, a push notification or a QR code,
on web and on mobile. Backend: `internal/linking`, exposed as **plain HTTP** rather than
Connect-RPC.

### Format

```
https://<webapp>/o/{tenantKey}/r/{resourceType}/{resourceId}?<allowed query>
```

`resourceType` ∈ `task`, `chat`, `thread`, `message`, `project`, `workspace`, `document`,
`calendar`, `booking`. Canonical version is `v1`.

Only five query keys survive normalisation — `focusIntent`, `entryContext`,
`requirementId`, `anchorType`, `anchorId`. Everything else is stripped and reported back as
`IgnoredQueryKeys`, so tracking parameters and stale state cannot leak into a shared link
or change what it opens.

`anchorType` ∈ `message`, `thread`, `requirement`, `section` — the sub-location within the
resource (a specific message, a specific evidence requirement).

The message anchor is what carries a reader between a conversation and the work that came
out of it. A task created from a chat message shows an origin block whose link opens the
channel anchored on the source message; the message shows a chip whose link opens the task
directly at its project-scoped route. Both are in-app navigations, not canonical-URL
round trips — the canonical shape is what a *shared* link looks like, and the anchor query
keys are the same either way.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/linking/generate` | build a canonical URL from a typed target |
| `POST /api/linking/resolve` | normalise + authorise + return per-platform routes |
| `POST /api/linking/previews` | per-reader card content for a **list** of canonical URLs |

### Resolution

`Service.Resolve` runs in a fixed order:

1. **Normalise** — parse the canonical path, or recognise a legacy route and rewrite it
   (`LegacyNormalized` flags this).
2. **Resolve tenant** from `tenantKey`; unknown tenant → `not_found`.
3. Build the canonical URL, the **web route** and the **mobile route**. `Resolve` carries
   no preview: card content is its own endpoint, because it is per reader and per page.
   The mobile route must be a route the app actually has: a task resolves to
   `/(app)/(tasks)/{projectId}/task/{taskId}` — with the static `task` segment the
   route-ambiguity invariant below requires — and a document to
   `/(app)/(more)/docs/{documentId}`, which the viewer accepts alongside a slug. A route
   Expo Router cannot match does not fail visibly; it drops the reader at the app root,
   which renders as the sign-in screen.
4. **Authenticate** — no principal → `auth_required`, with the routes already computed so
   the client can bounce through sign-in and land correctly.
5. **Authorise** — the actor's org must match the link's tenant, then a per-resource check
   (task, project, document, channel) → `ok` or `access_denied`.
6. **Fallback** — if the requested platform has no specific route, status becomes
   `fallback` and the caller uses the canonical URL.

Statuses: `ok`, `auth_required`, `access_denied`, `not_found`, `fallback`. Notably, an
unauthenticated resolve still returns the routes — resolution and authorisation are
separate answers, which is what makes deep-link-through-login work.

### Previews

`POST /api/linking/previews` takes `{"urls": [...]}` — at most `20`
(`linking.MaxPreviewURLsPerRequest`, mirrored as `MAX_PREVIEW_URLS_PER_REQUEST` in
`packages/apis`) — and answers with one item per requested URL, **in request order**,
echoing the URL as sent:

```json
{ "items": [ { "url": "...", "status": "ok", "preview": { ... } },
             { "url": "...", "status": "unavailable" } ] }
```

`status` is `ok` or `unavailable`, and nothing else. Access denied, not found, deleted,
cancelled, archived, another tenant's link, unauthenticated, a malformed URL and an
unsupported resource type are **all** `unavailable` with no `preview` body, byte for byte,
so the endpoint cannot be used to probe what exists. An unauthenticated request is not an
error: it is a `200` whose every item is `unavailable`, and it reads no database row. The
only error responses are `400` (malformed body, empty `urls`, or more than the bound —
rejected, never truncated) and `405`.

The handler runs in a fixed order: decode and bound; authenticate from the `Authorization`
header only (no `?token=` fallback — a preview is never the landing of a navigation);
normalise each URL; resolve each distinct tenant key on `AdminPool`; drop every target
outside the reader's organization; run each provider once on **`TenantPool`**; assemble in
request order.

A preview is composed from the linked resource's own rows and never from the URL. There is
no default branch: a target no provider resolves is `unavailable`, not a card titled
`task 0199c4f2-…`. The title falls back resource title → resource identifier → type name.

**Provider ownership** — each provider lives in the domain whose rows it reads
(Constitution IV); `internal/linking` owns no preview SQL. Wired in `cmd/server.go`:

| Provider | Package | Types | Query |
|---|---|---|---|
| `NewTaskPreviewProvider(queries, employeeNames)` | `internal/collaboration` | `task` | `ListTaskPreviews` |
| `NewProjectPreviewProvider(queries)` | `internal/collaboration` | `project` | `ListProjectPreviews` |
| `NewDocumentPreviewProvider(queries)` | `internal/docs` | `document` | `ListDocumentPreviews` |
| `NewEventPreviewProvider(queries)` | `internal/calendar` | `calendar` | `ListEventPreviews` |
| `NewChatPreviewProvider(queries)` | `internal/chat` | `chat`, `thread` | `ListChannelPreviews`, `ListThreadPreviews` |
| `NewBookingPreviewProvider()` | `internal/linking` | `booking` | none — generic card |

`message` and `workspace` describe no resource of their own and are not previewable.

Every provider is **batched**: `PreviewAggregator` groups a request's targets by the first
provider that `Handles` their type and calls each provider exactly once, so a request costs
one query per resource *type* present rather than one per link. A provider that errors
contributes nothing and is logged at `slog.WarnContext`; the other providers' results still
render. One `slog.InfoContext` per request records the reader, the URL count, the distinct
target count, the provider-call count and the duration.

Each provider's access predicate is **copied from the query that already owns that rule**
(`SearchTasks`/`ListTasksBySourceMessages`, `resolveProjectStatus`, `SearchDocuments`,
`SearchEvents`, `SearchChannels`), so a row the reader may not see is never loaded and
"which X may this reader see" keeps one definition per domain.

There is **no server-side cache**: a cache keyed by reader entitlement would have to be
invalidated whenever a project goes private, and getting that wrong is a disclosure rather
than a stale card. The only cache is per client session, in
`packages/apis/src/linking.ts`, cleared by `clearAuthToken()`.

### Client handling

- Web: `apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx` catches every canonical URL.
- Mobile: `app/o/[tenantKey]/r/[resourceType]/[resourceId].tsx`,
  `app/canonical-link/[encoded].tsx`, `app/+native-intent.tsx` (native deep-link intake),
  `app/link-handoff.tsx`, `app/link-status.tsx`, `app/canonical-signin.tsx`, and the
  `app/(shared)/resource/…` route group that renders a resource reached from outside the
  tab hierarchy.
- Shared: `packages/links/` (parsing, routing, `buildCanonicalLinkPreviewDisplay`,
  `MAX_PREVIEW_CARDS`), `packages/apis/src/linking.ts` (`fetchCanonicalPreviews` and the
  session cache — both apps go through it; neither hand-rolls a preview `fetch`),
  `apps/mobile/src/lib/canonical-links.ts` and `lib/linking.ts`.
- Previews are fetched at the **list**, not at the message: `useCanonicalLinkPreviews` in
  web's `VirtualizedMessageList` and in `apps/mobile/src/lib/canonical-link-previews.ts`
  collects the distinct canonical URLs of the rendered page (cap `MAX_PREVIEW_LOOKUP`,
  20), issues one request, and passes a `Map<url, preview>` down. Message components take
  the map as a prop and fetch nothing, so message text never waits on a card.

`make check-maestro-canonical-env` gates the mobile deep-link E2E flows;
`make check-maestro-link-preview-env` gates `chat-link-previews.yaml`.

## Federated search

Entry point is the workspace search box; results page at `/workspace/search`, mobile at
`app/(app)/(more)/search.tsx` and `app/(app)/(chat)/search.tsx`. On mobile the only entry
point is the `SearchPill` at the top of Chat, Today, My Work and Schedule — the More menu
no longer lists Search, because a menu row made a top-level verb look like a setting.

Search is **server-side**. `SearchService.Search` (`backend/rpc/v1/search.proto`,
`internal/search/`) answers one request by fanning out over **eight** sources concurrently
and returning one ranked list plus a per-source outcome report. `packages/apis/src/search.ts`
is a thin wrapper over that one RPC; there is no client-side fan-out and neither client
merges, ranks or caps anything.

`internal/search` owns **no SQL** and no access rule of its own. It depends on six domains'
logic-layer interfaces, injected in `cmd/server.go`, and merges what they return
(Constitution IV). It holds no `Queries` field and has no `.query.sql` file.

| Source (`SearchKind`) | Logic method | Permission | Access rule enforced in the query |
|---|---|---|---|
| `PERSON` | `organization.SearchEmployees` | `org.searchEmployees` | org-scoped by design |
| `CHANNEL` | `chat.SearchChannels` | `chat.search` | public channel or member of private |
| `DOCUMENT` | `docs.SearchDocuments` | `docs.view` | owner → employee grant (incl. an explicit `none`, which denies) → highest department grant → `visibility = 'public'` |
| `WORK_ITEM` | `collaboration.SearchTasks` | `collab.viewTask` | `p.visibility = 'public' OR project_membership`; excludes deleted tasks and archived projects |
| `EVENT` | `calendar.SearchEvents` | *(none — any authenticated caller)* | organiser OR attendee OR `visibility IN ('team','org_wide')`; cancelled events excluded |
| `FILE` | `files.SearchFiles` | `files.search` | the file's `file_access_rule.context_id` must be one of the caller's contexts |
| `DEPARTMENT` | `organization.SearchDepartments` | `org.searchDepartments` | org-scoped by design |
| `MESSAGE` | `chat.SearchMessages` | `chat.search` | messages in channels the caller can read |

That table is also the fixed **source-priority order**, and the order the eight
`SourceOutcome` entries always come back in.

**Ranking.** The eight matchers score on incomparable scales, so there is no cross-source
relevance number. The merge is round-robin by within-source rank, sorted ascending by
`(rank_within_source, source_priority, kind, id)`. The key ends in an identifier, so the
order is total: the same query over the same data produces the same list on web and on
mobile by construction. Every source's best hit precedes any source's second-best, so one
matching document sits inside the first screen even against a hundred matching messages.

**Bounding.** Mixed list: `limit` defaults to 40, max 80, capped at **5 hits per source**
before the merge. Narrowed to one kind (`kind_filter`): default 20, max 50, per-source cap
skipped. Limits are clamped, never rejected. A query shorter than 2 characters after
trimming is `InvalidArgument`; longer than 200 characters is truncated. Constants live in
`internal/search/logic.go`, not in the wire contract.

**Failure and permissions.** Each source runs in its own goroutine with an 800 ms deadline
inside a 900 ms overall budget, and a panicking adapter is caught. A source that errors or
times out is reported `SOURCE_STATUS_UNAVAILABLE` with a short non-sensitive detail and the
search still returns everything else. A source whose permission the caller lacks is
reported `SOURCE_STATUS_NOT_PERMITTED` and is never queried — a skip, not a failure. The
only error response is `CodeUnavailable`, and only when at least one source was attempted
and none returned `OK`; a caller permitted to search nothing gets a normal empty success.
`SourceOutcome.hit_count` counts only rows actually in the response, after capping, so no
count discloses withheld work.

**What a row carries.** `SearchHit` is `kind`, `title`, `context_line`, `snippet`, `rank`
and a flat `SearchTarget` with one named field per identifier, so a client opens a row with
no second lookup. Two fields are load-bearing: a document carries its **slug** (both
viewers route by slug), and a work item carries its **project id** alongside the task id
(both task routes are project-scoped). `snippet` is populated only by documents and
messages — the two sources that produce one and whose content the caller is entitled to
read.

**Clients.** Both render the one list in the order returned:

- Web `/workspace/search` — one row component per kind under `search/components/`, all
  through the shared `SearchResultCard`; an "All" tab plus one tab per kind, each labelled
  with its `hit_count`; the selected kind lives in the URL (`?kind=`) so narrowing survives
  a query change. Unavailable sources are named in a banner; not-permitted sources stay
  silent. `GlobalSearchBar` renders the same ranked list as a dropdown preview.
- Mobile `(more)/search.tsx` — the same eight kinds with badges and `testID`s, routing:
  Person → DM via `CreateOrGetDirectMessage`, Channel/Message → `(chat)/{channelId}`,
  Document → `(more)/docs/{slug}`, File → `(more)/files/{fileId}`, Work item →
  `(tasks)/{projectId}/task/{taskId}`, Event → `(calendar)/{eventId}`, Department →
  `(more)/people/department/{departmentId}`, the member list added by feature 048. Every
  kind now opens something; no mobile result row is informational. The department arm
  calls `GetDepartment` before navigating, so a department deleted since it was saved
  routes through the same stale-recent path every other kind uses. Recent items stay in
  device MMKV, never on the server, and a recent whose target will not open says "this
  item is no longer available" and removes itself.

Web routes events to `/workspace/calendar` rather than a per-event page, because the web
app has no event detail route; mobile opens the event itself.

Matching is PostgreSQL trigram (fuzzy, people and departments) and PGroonga (multilingual
full text, everything else), with language detection via `lingua-go` in
`internal/organization/language_detector.go`. `idx_event_pgroonga` and
`idx_file_metadata_filename_pgroonga` back the two sources that previously matched with no
index at all. Autocomplete keeps its own narrower RPCs (`AutocompleteEmployees`,
`AutocompleteDepartments`, `AutocompleteChannels`).

## Context rail

The right-hand panel that answers "what is this screen about, and what do I owe anyone".
Web: `apps/web/src/app/workspace/components/context-rail/` — `ContextRail.tsx`,
`ContextRailSection.tsx`, `GlobalContextBlocks.tsx`, `useGlobalContextRailData.ts`.

Two backend feeds:

- **`CollaborationService.GetAssignedWorkSummary`** — the global block. Returns `as_of_date`,
  `due_today_count`, `overdue_count`, and up to `limit` items (default 5, max 20) each with
  project key, title, state name, due date and an `urgency_bucket`.
  `include_ritual_instances` toggles whether ritual instances count.
  The bucket is `ps.category = 'overdue' OR t.due_date < as_of_date`: standard tasks bucket
  on the date, ritual instances on the state the reconciliation sweep wrote, so the rail
  cannot disagree with the ritual surfaces. A `missed` instance leaves the rail entirely,
  because the seeded `Missed` state is `is_closed = true` and the query already filters
  closed states out.
  (`internal/collaboration/context_rail_logic.go`)
- **`ChatService.GetChannelContextSummary`** — the channel-scoped block: what the current
  channel is linked to.

The rail is deliberately read-only and cheap; it must not become a second task list.

## Theme and preferences

`PreferenceService` (`internal/preference`) — three RPCs: `GetUserPreference`,
`UpdateUserPreference`, `ResetUserPreference`, all inferring employee and org from the auth
context rather than taking IDs.

`iam.user_preference` stores:

- `theme_mode IN ('light','dark')` — there is no explicit `system` value
- `preference_source IN ('manual','os_default')` — this is what encodes "follow the OS".
  An OS theme change overrides the stored value **only** when `preference_source =
  'os_default'`; once the user clicks the toggle it becomes `manual` and stops following.
- `additional_preferences` JSONB, reserved for locale/timezone/etc. and not exposed in v1

Design tokens live in `frontend/packages/theme-tokens` and are shared by web and mobile.
Client: `packages/apis/src/preference.ts`, `theme-storage.ts`.

**Both clients participate.** `getMobilePalette(mode)` returns mode-dependent values for
the mobile-only semantic groups (`presence`, `notificationDomain`, `taskState`,
`eventCategory`, `priority`, `overlay`) as well as the shared base palette; the bare
per-group exports were removed, so the only way to reach a semantic colour is through the
palette. Every mobile screen builds its styles at render time through `makeStyles` in
`apps/mobile/src/lib/theme.tsx`, which caches one `StyleSheet` per mode.

### How mobile resolves a theme

The decision is a pure function, `apps/mobile/src/lib/theme-resolution.ts`, so it can be
exercised without a device (`pnpm --filter mobile check:theme-resolution`). First row that
matches wins:

| Condition | Theme | Source | Writes back |
|---|---|---|---|
| Signed out | the phone's setting | `os_default` | nothing |
| Stored row, `manual` | the stored mode | `manual` | nothing |
| Stored row, `os_default` | the phone's setting | `os_default` | `(phone, os_default)`, only if it differs from what is stored |
| Server answered, no row | the phone's setting | `os_default` | `(phone, os_default)` |
| Server not answered, per-person cache present | the cached mode | `os_default` | nothing |
| Server not answered, device key present | the device's last mode | `os_default` | nothing |
| Nothing known | the phone's setting | `os_default` | nothing |

Presence of a stored preference is keyed off `exists`, never off `theme_mode`:
`protoThemeModeToString` coerces an enum value it does not recognise to `'light'`, so a
value the client cannot read is treated as no preference and the app follows the phone
rather than pinning to light.

The last three rows are provisional — they paint, they never write, and they are
superseded the moment the server answers. They report `os_default` so a cached value can
never masquerade as a deliberate choice. Only the Settings theme switch writes `manual`.

Two local keys back the first frame: the existing per-person
`theme_preference_{employeeId}`, and a device-scoped `theme_last_known` holding nothing but
`'light'` or `'dark'`. The device key exists because `employeeId` arrives asynchronously
from SecureStore while MMKV reads synchronously, so at frame zero there is no person to key
a lookup by. Both are cleared on sign-out, so a remembered theme is never shown to a second
person. Launch never blocks on the network: an unreachable server leaves the app on whatever
the cache says, logged and not surfaced.

Native controls — the keyboard, text carets, selection handles, pickers, `Switch` tracks,
scroll indicators — follow through `Appearance.setColorScheme`, driven by the *preference
source* rather than by the mode: `'unspecified'` (React Native's "follow the OS") while the
theme follows the phone, the chosen mode once somebody has chosen. That single mechanism
gives all three of "native controls match", "follow a later OS change while `os_default`",
and "ignore the OS once `manual`", because `setColorScheme` also overrides what `Appearance`
reports back.

**Deliberate divergence between the clients.** Mobile follows a *later* OS change while
`preference_source = 'os_default'`; the web `ThemeProvider`
(`apps/web/src/components/ThemeProvider.tsx`) adopts the OS scheme once on first run and
never re-reads it. Both read the same stored contract under different rules. This is
intentional — the mobile requirement asked for it and changing the web was out of scope —
and is recorded in the drift register rather than silently absorbed.

Two runnable guards keep this honest, both wired into `make test-frontend`:
`packages/theme-tokens/src/contrast.check.ts` measures every declared foreground/background
pairing in both modes against WCAG 2.1 AA, and an ESLint `no-restricted-syntax` rule scoped
to `apps/mobile/src/**` rejects raw hex and `rgba(...)` string literals.

## Feature tour

Two short card sequences shown once per person per organization on first arrival, and
replayable on demand. **The tour is server-driven**: which tour, which stops, in what
order, whether to offer it, and every word of copy come from one `GetTour` call. The
clients render cards and map a target enum to a route — they evaluate no permissions and
hold no copy, which is what makes two tours across two platforms cost roughly one tour's
worth of code.

`TourService` (`internal/tour`) — two RPCs, both inferring employee and org from the auth
context:

| RPC | Permission | Purpose |
|---|---|---|
| `GetTour(platform)` | `tour.view` | the caller's tour, filtered and platform-adapted, plus their progress and whether to offer it |
| `UpdateTourProgress(status, current_stop)` | `tour.update` | record where they got to |

`tour.view` and `tour.update` are granted to `owner`, `operator` and `employee` alike —
everyone needs to see their own tour, so unlike most permissions these have no exclusion
list.

**Audience.** Holding `iam.inviteUser` selects the administrator tour; everyone else gets
the worker tour. Not a role check: a custom role granted that permission is, for tour
purposes, an administrator, which is the correct answer rather than an accident. The
caller cannot ask for the other tour — there is no audience field on the request.

**Content is Go values**, not rows: `internal/tour/content.go`, versioned by a
`ContentVersion` constant. A tour authoring interface is out of scope, so a content table
would be a table with a dozen immutable rows nobody can edit. Copy changes ship with a
backend deploy, which works because all clients here release together. The administrator
tour is six stops (people, project, ritual, chat, schedule, docs); the worker tour is four
(today, evidence, chat, alerts).

**Filtering happens on the server**, in this order:

1. A stop whose `RequiredPermission` the caller lacks is **omitted entirely**, not
   disabled. The returned list is the numbering, so the survivors renumber from zero with
   no gap.
2. For a mobile caller, a **web-only** stop has its body replaced by a "this is done on
   the web" note and its target forced to `TOUR_TARGET_NONE` with an empty action label,
   so no client can render an action that cannot work. One administrator stop is web-only:
   `people` — adding staff, importing a team and setting roles have no mobile surface. The
   `project` and `ritual` stops arrive whole on a phone, with the same body a web
   administrator reads and an action that lands on `/(app)/(tasks)/create-project` and
   `/(app)/(tasks)/{firstProjectId}/create-ritual` respectively.
3. `current_stop` is **clamped to the filtered list on read and not written back**. The
   stored index addresses a list whose length depends on permissions, so revoking one can
   leave it past the end; the clamp keeps `stops[current_stop]` renderable, and leaving
   the stored value alone means restoring the permission restores the position.

**Progress** lives in `iam.tour_progress`, one row per `(organization_id, employee_id,
tour_id)`, `ON DELETE CASCADE` to `organization.employee` and swept explicitly by the
account-deletion path in `internal/iam/logic_account_deletion.go`. Statuses are
`in_progress`, `completed` and `dismissed`. **"Not started" is the absence of a row** —
reading the tour never writes one, which keeps workspace entry a read path and keeps the
completion-rate denominator honest. `content_version` records which wording the person
actually saw; nothing reads it today.

`should_offer` is true only for not-started and in-progress, and is deliberately
independent of platform: a tour completed on web is not offered on mobile. Completing and
dismissing are both terminal for the automatic offer and both re-enterable by a deliberate
restart, which writes `in_progress` at stop 0. The two tours are remembered independently,
so a worker promoted mid-tour is offered the administrator tour as not-started while their
worker progress stays untouched.

**What the clients own**, because only they know it:

- *When* to show the offer — after authentication and the terms gate, after the onboarding
  redirect on mobile, and never while a deep-link redirect is being followed.
- *Where* to show it — the tour belongs to one surface, not to the whole app. On web that
  is the workspace home (`/workspace/calendar`, where `/workspace` redirects); on mobile it
  is whichever screen the person was on when the tour loaded. Everywhere else it is hidden
  rather than discarded, so it appears when they arrive somewhere it belongs. Without this
  the offer is a modal over whatever the person actually came to do — the task they
  followed a link to, the settings page they opened to delete their account. An explicit
  "Take the tour" is exempt: that is a request, not an interruption, and it opens where it
  was asked for.
- *Reopening after an action* — acting on a stop closes the tour and navigates; returning
  to the surface it was offered from reopens it at the stored stop, unprompted and with no
  second progress write.
- *Route resolution* — `TourTarget` → a platform path. Each client's map is a
  `Record<TourTarget, ...>`, so a new target added to the proto fails the build until it
  has a route: `packages/apis/src/tour.ts` converts the enum to a string union, and
  `apps/web/src/lib/tour-routes.ts` and `apps/mobile/src/lib/tour-routes.ts` map that union
  (Constitution VIII). The web project, ritual and docs routes land with the create action
  open rather than on an empty list; on both platforms the ritual route falls back to
  project creation when the workspace has no project, and the card says why — the mobile
  card renders that note at `testID="feature-tour-ritual-fallback-note"`, matching the web
  `data-testid` of the same name.

Presentation is purpose-built per platform and shares no code: a centred MUI dialog on web
(`apps/web/src/components/tour/`), a bottom card sheet on mobile
(`apps/mobile/src/components/feature-tour.tsx`). Neither anchors to or highlights any live
element — the stops describe capabilities, not controls. Replay is offered from the web
user menu and the mobile More tab.

## Web application

Next.js App Router, MUI v7, in `apps/web/src/app`:

- **Public** — `/`, `/pricing`, `/signup`, `/signin`, `/login/pin`, `/forgot-password`,
  `/reset-password`, `/accept-invitation`, `/callback`, `/privacy`, `/terms`, and a static
  help site under `/docs` (product guide, features, owner and employee guides).
  `/privacy` and `/terms` are `force-static` and must stay reachable signed out: both app
  stores require a policy URL anyone can open, and the mobile app links to these rather
  than carrying a second copy of the text.
- **Canonical** — `/o/[tenantKey]/r/[...slug]`.
- **Workspace** — `/workspace/{chat, projects, tasks, reviews, docs, files, calendar,
  notifications, organization, profile, search, voice,
  settings/{notifications, presence, blocked, reports, removal-requests}}`.
  The last three are administrative or personal-safety surfaces added with the compliance
  domain; `reports` and `removal-requests` are web-only by Constitution XIII, enforced by
  permissions on the RPCs rather than by hiding the links.

E2E with Playwright in `apps/web/e2e`; `make test-frontend`.

### Review queue entry points

The **Reviews** tab (`/workspace/reviews`, ⌘8, `data-testid="workspace-tab-reviews"`) is
gated on the `collab.reviewEvidence` permission and is absent for anyone without it, which
pushed CRM to ⌘9. Its badge (`workspace-tab-reviews-badge`) comes from
`GetEvidenceReviewQueueCount`, fetched separately from the queue itself so the count does
not wait on the list, and renders "99+" when the server reports the count was capped. A
project page links into the same surface narrowed to itself, `/workspace/reviews?projectId=`,
rather than carrying its own per-project backlog component.

On mobile the queue is a stack route in the tasks area, `(app)/(tasks)/review`, **not** a
fifth bottom tab — reviewing is part of running the work, and a fifth tab would cost every
employee screen width for a surface only reviewers can open. It is reached from an
entry-point card on the tasks tab (`testID="review-queue-entry-card"`) that carries the same
count, is hidden entirely when `can_review` is false, and says "Nothing to review right now"
when the caller reviews evidence but has an empty queue. The card and the queue are
purpose-built for a phone: one full-width card per submission, the photo rendered at device
width with a full-screen tap target, and approve/reject as the only primary actions, so a
decision never needs a second screen. Behaviour is described in
[rituals-tasks.md](rituals-tasks.md#review-queue).


## Mobile application

Expo Router in `apps/mobile/src/app`, five route groups:

- `(auth)` — `index` is the sign-in screen and is PIN-first: it reads the device's
  remembered state and renders either the known-device shape (name, workspace, six PIN
  boxes) or a revealed workspace → identifier → PIN sequence. There is no method picker.
  Also `signin` (email, password, SSO), `signup` (owner workspace creation), `set-pin`
  (a worker choosing their own PIN), `sso-callback`, `accept-invitation`,
  `forgot-password`, `reset-password`.
- `(onboarding)` — the owner's first-run sequence after signup: `set-pin` (mandatory,
  non-dismissible) then `add-teammate` (skippable). Its `_layout` redirects into the first
  incomplete step so an interrupted owner resumes there. See
  [auth-identity.md](auth-identity.md#client-surfaces).
- `(app)` — the tab hierarchy. **Four tabs are on the bar: `(chat)`, `(today)`, `(tasks)`
  (labelled "My Work"), `(more)`.** `(calendar)` and `(notifications)` are still full route groups —
  registered with `href: null` so deep links, push taps and canonical links resolve — but
  they own no tab slot: Schedule opens from the Today header, Alerts from the bell in the
  Chat header, which carries the `GetUnreadCount` badge.
  - `(today)` is the single day view: overdue assigned work, the **Team block**, today's
    events, then work due today. It reads `CollaborationService.GetAssignedWorkSummary`
    (overdue + due-today across every project, no client fan-out),
    `CalendarService.ListEvents` over today, and
    `CollaborationService.GetTeamAttentionSummary`. All three queries are declared in the
    same render, so the round trips are concurrent rather than chained. See
    [the Team block](#the-team-block-on-mobile-today) below.
  - `(tasks)` opens in Focus mode; the project-first drilldown is behind the
    `task-mode-toggle` header action rather than a body segmented control. Two modal
    screens hang off it: `create-project` and `[projectId]/create-ritual`. Each is offered
    only to someone who can complete it — `collab.createProject` for the first,
    `collab.manageRitualDefinition` plus project role `owner` or `admin` for the second —
    and the affordance is **absent** rather than disabled otherwise. See
    [rituals-tasks.md](rituals-tasks.md) for what each collects.
  - The layout is wrapped in `TermsGate`, which holds the app behind a read-and-accept
    screen while `GetTermsStatus` says this person has not accepted the version currently
    being served. It fails open on a network error, so a blip does not lock somebody out
    of their work.
  - `(more)` is the menu tab. Its index lists two labelled groups — **Workspace**
    (People, Documents, Files) and **App** (Settings, and a Help row that opens the web
    guide site in the system browser) — plus a Sign Out row. People is the only row that
    is conditional: it is rendered only when `iam.listEmployees` is in the permission set
    cached under `["employee-permissions", employeeId]`, so a member without it does not
    see the row rather than seeing it and being refused on tap. The menu is long enough
    that Sign Out now sits below the fold on a 360 dp screen; it is reached by scrolling,
    and `screens/more.yaml` gates on `menu-settings` rather than on Sign Out for that
    reason. Search is deliberately not listed;
    it is reached from the `SearchPill` at the top of the other tabs. A **Developer**
    group holding `navigation-debug` appears only under `__DEV__`, and the screen itself
    returns a `Redirect` outside development, so the harness cannot surface in a shipped
    build even through a deep link.
  - `(more)/profile` is editable: it changes the display name through
    `IAMService.UpdateProfile` and writes the result into the `userProfile` query cache,
    which is where every other screen reads the name from. Email, department,
    organization and role are shown as read-only, in words — the screen used to print the
    employee and organization UUIDs instead.
  - `(more)/settings` carries the Notifications, Safety, Legal and Account sections —
    the in-app alert toggle and a nine-row "Mute by area" list, blocked people, abuse
    contact, the two published documents, and whichever of `delete-account` or
    `request-removal` this person's path is, asked of the server rather than inferred.
    The two notification controls are server-stored and follow the person across devices;
    they are described in
    [notifications-presence.md](notifications-presence.md#the-personal-preference-record).
    See [compliance-safety.md](compliance-safety.md).
    The **Appearance** section carries the theme switch (`theme-toggle-row`, on ⇒ dark).
    It records a deliberate choice — `preference_source = 'manual'` — which is the only
    place in the app that writes that value, and it is the only thing that stops the app
    following the phone. The screen repaints on the press, before the write settles; if the
    write fails the control and the theme return to where they were and the screen says so,
    because an app showing one theme while the server stores the other is worse than a
    refused change. See [Theme and preferences](#theme-and-preferences).
  - `(more)/docs` and `(more)/files` are read-oriented lists; `(more)/search` is the
    global federated search screen.
- `(shared)` — resource routes reached from a deep link rather than a tab, so a link opens
  the resource without hijacking tab state
- top level — `booking/[token]`, `canonical-link/[encoded]`, `o/[tenantKey]/r/…`,
  `+native-intent`, `link-handoff`, `link-status`, `[...path]` catch-all. `link-handoff`
  and `canonical-signin` both re-export the `(auth)` sign-in screen, which parks a pending
  redirect and follows it once the user authenticates.

**Route patterns may never be all-dynamic at differing depths.** Expo Router compiles a
group segment in a route pattern to an *optional* regex group and ranks candidates by
static-segment count and then by segment count, so a route made only of dynamic segments
outranks a shorter all-dynamic route and consumes the literal group token of its href.
While the task screen lived at `(app)/(tasks)/[projectId]/[taskId]`, every
`/(app)/(chat)/<channelId>` and `/(app)/(calendar)/<eventId>` push resolved to it as
`{projectId: "(chat)", taskId: "<channelId>"}` — a notification tap on a direct message
opened the Tasks tab showing "Task not found". The task screen therefore lives at
`(app)/(tasks)/[projectId]/task/[taskId]` (and `(shared)/resource/tasks/[projectId]/task/[taskId]`),
whose static `task` segment cannot match a group token.
`apps/mobile/scripts/check-route-ambiguity.mjs` asserts the invariant.

Notable hooks: `use-sse`, `use-presence`, `use-app-state-presence` (presence follows
foreground/background), `use-push-notifications`, `use-stream-recovery-refresh` (refetch
after a stream gap), `use-resolved-project-id`, `use-ghost-loading`.

E2E with Maestro, laid out in `apps/mobile/.maestro/`: `screens/` holds one flow per
top-level surface (`chat`, `today`, `my-work`, `schedule`, `alerts`, `more`), `auth/` and
`onboarding/` hold the user-story flows, and the root holds per-feature behavioural flows.
`make test-mobile` (`scripts/run-maestro-suite.sh`) runs the two story flows
(`auth/signin-known-device`, `onboarding/owner-signup`), then the screen sweep, then the
behavioural flows the runner names.

Every flow that starts from a fresh install begins with `auth/dev-client-bootstrap.yaml`,
which clears state and then **opens the Metro bundle URL directly** rather than tapping a
server in the dev-client launcher. The launcher only lists a server it can discover on the
same host, so tapping works on a simulator or emulator and finds nothing on a physical
device, where Metro is across the LAN. The URL comes from `MAESTRO_DEV_CLIENT_URL`, which
the Makefile and the suite runner both build from `scripts/resolve-ip.sh` — the same LAN IP
the dev commands use. The bootstrap then dismisses the developer menu, which is shaped
differently on each platform: Android puts the greeting behind a Continue button and labels
the close control only with a content description, iOS shows the greeting inside the menu
and exposes the SF Symbol as an identifier.
Design guidance lives in the `building-native-ui` skill and `specs/mobile-ui-design.md`.

### The Team block on mobile Today

Between "Running late" and "Today's schedule", Today shows a **Team** section to callers who
both hold `collab.reviewEvidence` and are `owner` or `admin` on at least one project. It
lists the ritual instances those projects are late on, and the ones scheduled for the
device's local date with nobody holding them, so a shift supervisor can answer "is the store
OK" without opening a project. The backing RPC and its predicates are described in
[rituals-tasks.md](rituals-tasks.md#team-attention-summary).

**Who sees it.** Nobody else. When `can_supervise` is false the block renders *nothing* — no
heading, no card, no skeleton, no placeholder — so a worker's Today is byte-for-byte what it
was. `can_supervise` is a distinct response field rather than an inference from a zero count,
because "you supervise nothing" and "your team is fine" must not look the same on screen. A
supervisor with nothing wrong sees an explicit all-clear naming how many projects it covered,
rather than the block vanishing: a block that disappears on a quiet morning is
indistinguishable from one that never applied.

**What it does not do.** No assignment, no reassignment, no bulk action, no configuration.
Tapping a row routes to the existing ritual instance screen, which already carries whatever
controls the caller is entitled to. This is why the block does not need Principle XIII's
administrative carve-out: checking whether this morning's opening ritual has anybody on it
*is* a day-to-day task for whoever runs the shift.

**It fails alone.** The Team query is deliberately absent from the screen's whole-screen
loading and error conditions, which stay wired to the work and events queries only. A team
feed that fails renders a retry (`today-team-retry`) confined to the block while the caller's
own overdue work, events and due-today work stay fully rendered — a supervisory extra must
never blank out the day a worker depends on. Once a response has reported
`can_supervise = false`, later loading and error states render nothing at all rather than
flashing a Team heading at a non-supervisor.

The block shares Today's existing refresh paths (`useManualRefresh` and
`useStreamRecoveryRefresh`) rather than owning a gesture or a poll timer. Counts beside the
heading are the server's true totals, rendered "99+" when the server reports the count
capped; "Show more" refetches with a larger limit rather than paging, to a ceiling of 20 rows
per category. Interactive elements carry `today-section-team`, `today-team-row-<taskId>`,
`today-team-expand` and `today-team-retry`.

## Shared frontend packages

| Package | Contents |
|---|---|
| `apis` | typed wrappers over every RPC — the only layer app code may call (Constitution VII) |
| `rpc` | generated Connect clients |
| `notifications` | `useSSEConnection`, `useNotifications`, `presenceState`, event types |
| `links` | canonical link helpers |
| `theme-tokens` | shared design tokens, and the runnable WCAG contrast sweep over them |
| `validations` | shared input validation |

`apis` also owns values the backend duplicates, so screens read them rather than restate
them: `PIN_LENGTH` and `TEMPORARY_PIN_EXPIRY_DAYS` (`iam-org-accounts.ts`), and the
workspace-address rules `deriveSubdomain` / `isValidSubdomain` / `normalizeSubdomain`
(`organization.ts`). See Constitution VIII.

Every wrapper routes through `rpcCall` (`rpcWrapper.ts`), which maps Connect codes onto the
error classes in `errors.ts`: `UNAUTHENTICATED` also notifies the auth-failure listeners,
`PERMISSION_DENIED` and `NOT_FOUND` become an `APIError`, `INVALID_ARGUMENT` a
`ValidationError`, and the transport codes a `NetworkError`. Two codes are deliberately
rethrown as the original `ConnectError` instead, because their **error details** are the
point and flattening them would leave the caller with a sentence and nothing to act on:
`RESOURCE_EXHAUSTED` (PIN lockout, read with `extractPinAuthErrorDetail`) and `ABORTED`
(a document save refused as a version conflict, read with
`extractDocumentVersionConflict`). Any future surface that attaches a detail must be added
to that list, or the detail never reaches a component.

## Tests

`integration/canonical_links_test.go`, `context_rail_test.go`, `preference_test.go`,
`feature_tour_test.go`, `federated_search_test.go`; `apps/web/e2e/`, including
`federated-search.spec.ts`; Maestro flows for mobile, including `.maestro/feature-tour/`,
`.maestro/federated-search.yaml`, `.maestro/settings/dark-mode-toggle.yaml` and
`.maestro/settings/notification-preferences.yaml`.

The mobile theme is guarded by two assertion scripts rather than by a flow, because neither
thing they check is observable to a blackbox driver.
`apps/mobile/src/lib/theme-resolution.check.ts` walks every row of the resolution table,
including the three provisional pre-answer rows — the ones a one-frame flash would come
from — and `packages/theme-tokens/src/contrast.check.ts` measures all 164 declared
foreground/background pairings in both modes. Both run under `make test-frontend`.
Thirteen pairings are pinned as pre-existing exemptions with the ratio measured at the
time: every one is a
`colors.ts` value shared with the web theme, so the register fails if one gets worse rather
than waiving it. The Maestro flow covers the happy path only — choose dark, restart, it is
still dark — asserted through the theme row's accessibility value, since Maestro cannot
sample a colour.

A third guard is a lint rule rather than a test: `no-restricted-syntax` scoped to
`apps/mobile/src/**` rejects string literals that are entirely a hex colour or an
`rgba(...)`, which is what stops the palette sweep being undone by the first screen that
reaches for `#fff`.

`internal/search/logic_test.go` covers the fan-out's failure paths — a failing source, a
panicking adapter, a source past its deadline, every source failing, and the round-robin
merge's determinism. They live there rather than in the integration suite because no
source can be made to fail through the RPC surface: every one is a healthy query against a
healthy database, and PGroonga accepts even malformed query syntax rather than erroring.

`feature_tour_test.go` also carries `TestTourPermissionIdsExist`, which asserts that every
permission id named in `internal/tour/content.go` still exists in `public.permission`.
Those ids are bare strings with no compile-time check, so without it a rename in a later
migration would flip the tour audience or hide a stop silently.

## Known drift

**Today's event sort can crash the whole screen.** `sortedEvents` compares
`left.startTime?.getTime()`, which guards `null` but not a wrong type, so a `startTime` that
arrives as a string throws and takes down all of Today — including the personal sections a
worker depends on. Seen once on the Android emulator; see D59 in the drift register.


**D46 — the Expo dev client's Tools button swallows header taps on Android.** The floating
overlay is on by default in a freshly installed debug build and sits over the top-right of
every screen, so a tap aimed at a header action — `task-mode-toggle` most often — opens the
dev menu instead. Maestro reports the tap as completed and then fails on the next assertion,
which reads as a missing element. Switch it off in the dev menu (shake, or the ✕ overlay)
before running flows against a new emulator. Not present in a release build.

**D47 — three older mobile flows still wait on a screen title that no longer exists.**
`ritual-submission-flow.yaml`, `ritual-procedure-doc.yaml` and
`tasks/evidence-review-approve.yaml` each `assertVisible: "Focus"` after opening the tasks
tab; the tab root is titled **My Work**. Feature 044's flows wait on the `task-mode-toggle`
testID instead. The three were left alone rather than changing assertions in flows unrelated
to that feature, and they cannot run at all while D40 stands.

**D43 — `Link asChild` silently drops a function `style` on mobile.** Under expo-router 55,
a `Pressable` nested in `<Link asChild>` with `style={({ pressed }) => [...]}` renders with
no style at all; the same component with a plain style object renders correctly. The review
queue's tasks-tab entry card was written the first way, shipped looking like unstyled text
on a real device, and was switched to a plain object. `ProjectRow`, `FocusTaskRow` and
`RitualFocusRow` in `app/(app)/(tasks)/index.tsx` still use the function form and are
presumably affected the same way; they were left alone rather than changed as a side effect
of an unrelated feature. Nothing catches this statically — the props typecheck — so only
looking at the screen finds it.

**Email sign-in stores the token before it asks for the profile.** `signin.tsx` and
`signup.tsx` call `setAuthToken` with the access token the moment `login` returns, ahead of
the `getProfile` call that resolves the membership id. The RPC auth interceptor in
`packages/apis/src/rpc.ts` reads the token from storage rather than from the result in hand,
so a `GetProfile` issued before the write goes out with no `Authorization` header and comes
back `Unauthenticated` — which `rpcWrapper` turns into "Your session is no longer valid" and
the screen reports as a failed sign-in. Both paths used to omit the write, and the fault was
invisible on any device that still held a previous session's token: it only appeared on a
genuinely signed-out install, which is exactly what a store reviewer has. The PIN paths in
`(auth)/index.tsx` and `(auth)/set-pin.tsx` have always written the token first; the email
paths now match them. Recorded as **D57** in the drift register until feature 055 found the
cause while verifying the demo workspace on a device.

**D37 — Maestro cannot drive a physical iPhone.** 2.3.0's `test` does not enumerate
connected iPhones; 2.8.0 and 2.10.0 do, but fail to build their XCUITest driver because the
`MaestroDriverLib` sources they extract are missing, so `xcodebuild` stops on absent input
files. Detection additionally requires the CoreDevice tunnel to be warm — run
`xcrun devicectl device info details --device <udid>` immediately beforehand, or the device
reads as "not connected". Android runs on real hardware; iOS is verified on a simulator
until an upstream release ships a complete driver bundle.

**D18 — a Maestro flow cannot drive the mobile signup password field.** iOS 18 lays its
automatic-strong-password cover view over the field on `(auth)/signup`, chosen
heuristically from the surrounding form. That view is a system view outside the app's
accessibility tree, so Maestro can neither see it, tap it, nor type past it, and
`onboarding/owner-signup.yaml` stops there. `textContentType="password"`, explicit
`autoComplete` and `passwordRules` were all tried and none suppress it; only a full
AutoFill opt-out does, at the cost of password-manager fill on the credential that is the
owner's PIN-recovery anchor. US2 and US3 therefore have backend scenario coverage but no
passing blackbox flow.

**Legacy route normalisation is open-ended.** `normalizeLegacyRoute` in
`internal/linking/normalize.go` accepts non-canonical paths and rewrites them. Given the
project's no-backward-compatibility stance, this is worth revisiting: every legacy shape it
accepts is a second URL grammar to keep working.

**D30 — the two clients read the same theme contract under different rules.** Mobile
follows a later OS change while `preference_source = 'os_default'`; the web
`ThemeProvider` adopts the OS scheme once on first run and never re-reads it, so a web
session left on `os_default` does not move when the machine switches to dark. This is
deliberate — following a later OS change is a mobile requirement, and changing the web
client was out of scope for the feature that added it — but it means the same stored row
means two things. Closing it means deciding which rule both clients should follow and
moving the resolver into `packages/apis` beside `theme-storage.ts`, where both can reach
it.

**`theme_mode` has no `system` value.** "Follow the OS" is expressed indirectly through
`preference_source = 'os_default'`. This works but is easy to get wrong from a new client,
which may write `manual` on first render and permanently pin the user's theme. On mobile
the guard is structural rather than remembered: `resolveTheme` never emits a `manual`
write, and `setMode` — the Settings control's only entry point — is the one function that
can.
