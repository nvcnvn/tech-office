# Workspace Shell & Navigation

The cross-cutting client experience: federated search, canonical cross-platform links, the
context rail, theme preferences, and the shape of the web and mobile apps.

**Status date: 2026-08-22.** Supersedes specs 011, 012, 013, 027, 030, 031.

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

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/linking/generate` | build a canonical URL from a typed target |
| `POST /api/linking/resolve` | normalise + authorise + return per-platform routes |
| `POST /api/linking/preview` | metadata for an unfurl card |

### Resolution

`Service.Resolve` runs in a fixed order:

1. **Normalise** — parse the canonical path, or recognise a legacy route and rewrite it
   (`LegacyNormalized` flags this).
2. **Resolve tenant** from `tenantKey`; unknown tenant → `not_found`.
3. Build the canonical URL, the **web route** and the **mobile route**, and the preview.
4. **Authenticate** — no principal → `auth_required`, with the routes already computed so
   the client can bounce through sign-in and land correctly.
5. **Authorise** — the actor's org must match the link's tenant, then a per-resource check
   (task, project, document, channel) → `ok` or `access_denied`.
6. **Fallback** — if the requested platform has no specific route, status becomes
   `fallback` and the caller uses the canonical URL.

Statuses: `ok`, `auth_required`, `access_denied`, `not_found`, `fallback`. Notably, an
unauthenticated resolve still returns the routes — resolution and authorisation are
separate answers, which is what makes deep-link-through-login work.

Preview providers are registered per resource type in `cmd/server.go`: task, document,
project, chat channel, chat thread, calendar event, booking.

### Client handling

- Web: `apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx` catches every canonical URL.
- Mobile: `app/o/[tenantKey]/r/[resourceType]/[resourceId].tsx`,
  `app/canonical-link/[encoded].tsx`, `app/+native-intent.tsx` (native deep-link intake),
  `app/link-handoff.tsx`, `app/link-status.tsx`, `app/canonical-signin.tsx`, and the
  `app/(shared)/resource/…` route group that renders a resource reached from outside the
  tab hierarchy.
- Shared: `packages/links/`, `apps/mobile/src/lib/canonical-links.ts` and `lib/linking.ts`.

`make check-maestro-canonical-env` gates the mobile deep-link E2E flows.

## Federated search

Entry point is the workspace search box; results page at `/workspace/search`, mobile at
`app/(app)/(more)/search.tsx` and `app/(app)/(chat)/search.tsx`.

There is **no backend federated-search service**. `packages/apis/src/search.ts` fans out
client-side with `Promise.all` over four RPCs, each individually `.catch(() => [])` so one
failing domain does not empty the page:

| Source | RPC |
|---|---|
| Employees | `OrganizationService.SearchEmployees` |
| Departments | `OrganizationService.SearchDepartments` |
| Channels | `ChatService.SearchChannels` |
| Messages | `ChatService.SearchMessages` |

Matching is PostgreSQL trigram (fuzzy) and PGroonga (multilingual full text), with language
detection via `lingua-go` in `internal/organization/language_detector.go`. Autocomplete has
its own narrower RPCs (`AutocompleteEmployees`, `AutocompleteDepartments`,
`AutocompleteChannels`).

## Context rail

The right-hand panel that answers "what is this screen about, and what do I owe anyone".
Web: `apps/web/src/app/workspace/components/context-rail/` — `ContextRail.tsx`,
`ContextRailSection.tsx`, `GlobalContextBlocks.tsx`, `useGlobalContextRailData.ts`.

Two backend feeds:

- **`CollaborationService.GetAssignedWorkSummary`** — the global block. Returns `as_of_date`,
  `due_today_count`, `overdue_count`, and up to `limit` items (default 5, max 20) each with
  project key, title, state name, due date and an `urgency_bucket`.
  `include_ritual_instances` toggles whether ritual instances count.
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

## Web application

Next.js App Router, MUI v7, in `apps/web/src/app`:

- **Public** — `/`, `/pricing`, `/signup`, `/signin`, `/login/pin`, `/forgot-password`,
  `/reset-password`, `/accept-invitation`, `/callback`, and a static help site under
  `/docs` (product guide, features, owner and employee guides).
- **Canonical** — `/o/[tenantKey]/r/[...slug]`.
- **Workspace** — `/workspace/{chat, projects, tasks, docs, files, calendar,
  notifications, organization, profile, search, voice, settings/{notifications,presence}}`.

E2E with Playwright in `apps/web/e2e`; `make test-frontend`.

## Mobile application

Expo Router in `apps/mobile/src/app`, four route groups:

- `(auth)` — sign-in, sign-up, PIN, set-PIN, SSO callback, invitation, password reset
- `(app)` — the tab hierarchy: `(chat)`, `(tasks)`, `(calendar)`, `(notifications)`,
  `(more)` (docs, files, profile, settings, search, navigation-debug)
- `(shared)` — resource routes reached from a deep link rather than a tab, so a link opens
  the resource without hijacking tab state
- top level — `booking/[token]`, `canonical-link/[encoded]`, `o/[tenantKey]/r/…`,
  `+native-intent`, `link-handoff`, `link-status`, `[...path]` catch-all

Notable hooks: `use-sse`, `use-presence`, `use-app-state-presence` (presence follows
foreground/background), `use-push-notifications`, `use-stream-recovery-refresh` (refetch
after a stream gap), `use-resolved-project-id`, `use-ghost-loading`.

E2E with Maestro; `make test-mobile`. Design guidance lives in the `building-native-ui`
skill and `specs/mobile-ui-design.md`.

## Shared frontend packages

| Package | Contents |
|---|---|
| `apis` | typed wrappers over every RPC — the only layer app code may call (Constitution VII) |
| `rpc` | generated Connect clients |
| `notifications` | `useSSEConnection`, `useNotifications`, `presenceState`, event types |
| `links` | canonical link helpers |
| `theme-tokens` | shared design tokens |
| `validations` | shared input validation |

## Tests

`integration/canonical_links_test.go`, `context_rail_test.go`, `preference_test.go`;
`apps/web/e2e/`; Maestro flows for mobile.

## Known drift

**D5 — spec 011's "global search system" is four client-side calls.** Server-side search
exists for documents (`SearchDocuments`), files (`SearchFiles`, with access filtering),
calendar (`SearchEvents`) and tasks (PGroonga + trigram indexes on `collaboration.task`
`title`), but none of them are in `searchAll`. A user searching for a document title from
the workspace search box gets nothing. Wiring them in is additive — the client aggregator
already tolerates per-source failure — but it also needs result-type handling in
`CategoryTabs`/`SearchResults`, and files/docs results must respect their own access rules
rather than being filtered client-side.

**Legacy route normalisation is open-ended.** `normalizeLegacyRoute` in
`internal/linking/normalize.go` accepts non-canonical paths and rewrites them. Given the
project's no-backward-compatibility stance, this is worth revisiting: every legacy shape it
accepts is a second URL grammar to keep working.

**`theme_mode` has no `system` value.** "Follow the OS" is expressed indirectly through
`preference_source = 'os_default'`. This works but is easy to get wrong from a new client,
which may write `manual` on first render and permanently pin the user's theme.
