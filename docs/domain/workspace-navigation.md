# Workspace Shell & Navigation

The cross-cutting client experience: federated search, canonical cross-platform links, the
context rail, theme preferences, the feature tour, and the shape of the web and mobile
apps.

**Status date: 2026-09-02.** Supersedes specs 011, 012, 013, 027, 030, 031, 035, 039.

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
`app/(app)/(more)/search.tsx` and `app/(app)/(chat)/search.tsx`. On mobile the only entry
point is the `SearchPill` at the top of Chat, Today, My Work and Schedule — the More menu
no longer lists Search, because a menu row made a top-level verb look like a setting.

There is **no backend federated-search service**. `packages/apis/src/search.ts` fans out
client-side with `Promise.all` over four RPCs, each individually `.catch(() => [])` so one
failing domain does not empty the page:

| Source | RPC |
|---|---|
| Employees | `OrganizationService.SearchEmployees` |
| Departments | `OrganizationService.SearchDepartments` |
| Channels | `ChatService.SearchChannels` |
| Messages | `ChatService.SearchMessages` |

Because those four are all that come back, the mobile screen renders and routes exactly
four row kinds. Person rows open (or create) the DM via `CreateOrGetDirectMessage` and
surface a failure rather than swallowing it; Channel rows open the channel; Message rows
open the channel they were posted in with `highlightedMessageId` set — they used to be
inert; Department rows are informational, because mobile has no department screen. Task,
Event and Document rows were configured with tap handlers that nothing could ever reach.

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

**Only the web app participates.** `theme-tokens` exports a `darkPalette`, but every
mobile screen imports `lightPalette` by name, and mobile never calls `PreferenceService`
for theme at all. See [D30](#known-drift).

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
   so no client can render an action that cannot work. Three administrator stops are
   web-only: `people`, `project` and `ritual` — the mobile app can list projects and
   rituals but has no create surface for either.
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
  open rather than on an empty list; the ritual route falls back to project creation when
  the workspace has no project.

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
- **Workspace** — `/workspace/{chat, projects, tasks, docs, files, calendar,
  notifications, organization, profile, search, voice,
  settings/{notifications, presence, blocked, reports, removal-requests}}`.
  The last three are administrative or personal-safety surfaces added with the compliance
  domain; `reports` and `removal-requests` are web-only by Constitution XIII, enforced by
  permissions on the RPCs rather than by hiding the links.

E2E with Playwright in `apps/web/e2e`; `make test-frontend`.

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
  - `(today)` is the single day view: overdue assigned work, today's events, then work due
    today. It reads `CollaborationService.GetAssignedWorkSummary` (overdue + due-today
    across every project, no client fan-out) and `CalendarService.ListEvents` over today.
  - `(tasks)` opens in Focus mode; the project-first drilldown is behind the
    `task-mode-toggle` header action rather than a body segmented control.
  - The layout is wrapped in `TermsGate`, which holds the app behind a read-and-accept
    screen while `GetTermsStatus` says this person has not accepted the version currently
    being served. It fails open on a network error, so a blip does not lock somebody out
    of their work.
  - `(more)` is the menu tab. Its index lists two labelled groups — **Workspace**
    (Documents, Files) and **App** (Settings, and a Help row that opens the web guide
    site in the system browser) — plus a Sign Out row. Search is deliberately not listed;
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
    the in-app alert toggle, blocked people, abuse contact, the two published documents,
    and whichever of `delete-account` or `request-removal` this person's path is, asked of
    the server rather than inferred. See [compliance-safety.md](compliance-safety.md).
    **There is no Dark Mode switch on mobile.** Every mobile screen paints from
    `lightPalette`, so the toggle only darkened the native controls — Switch, keyboard,
    carets — sitting on a light UI. `app/_layout.tsx` now pins
    `Appearance.setColorScheme("light")` at startup instead, which is what keeps those
    controls consistent on a phone whose OS is in dark mode. The switch returns with the
    theme, not before it.
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

## Shared frontend packages

| Package | Contents |
|---|---|
| `apis` | typed wrappers over every RPC — the only layer app code may call (Constitution VII) |
| `rpc` | generated Connect clients |
| `notifications` | `useSSEConnection`, `useNotifications`, `presenceState`, event types |
| `links` | canonical link helpers |
| `theme-tokens` | shared design tokens |
| `validations` | shared input validation |

`apis` also owns values the backend duplicates, so screens read them rather than restate
them: `PIN_LENGTH` and `TEMPORARY_PIN_EXPIRY_DAYS` (`iam-org-accounts.ts`), and the
workspace-address rules `deriveSubdomain` / `isValidSubdomain` / `normalizeSubdomain`
(`organization.ts`). See Constitution VIII.

## Tests

`integration/canonical_links_test.go`, `context_rail_test.go`, `preference_test.go`,
`feature_tour_test.go`; `apps/web/e2e/`; Maestro flows for mobile, including
`.maestro/feature-tour/`.

`feature_tour_test.go` also carries `TestTourPermissionIdsExist`, which asserts that every
permission id named in `internal/tour/content.go` still exists in `public.permission`.
Those ids are bare strings with no compile-time check, so without it a rename in a later
migration would flip the tour audience or hide a stop silently.

## Known drift

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

**D30 — mobile does not participate in the theme system.** `PreferenceService` stores a
`theme_mode` per user and `theme-tokens` exports a `darkPalette`, but the mobile app
imports `lightPalette` directly in every screen and never reads or writes the preference.
Its Settings screen used to carry a Dark Mode switch that wrote a local MMKV key and
called `Appearance.setColorScheme`, which changed nothing the app paints and left the
native controls dark on a light UI; the switch has been removed and the color scheme
pinned to light. Closing this means threading a palette through the mobile screens and
then reading `GetUserPreference`, not restoring the toggle.

**`theme_mode` has no `system` value.** "Follow the OS" is expressed indirectly through
`preference_source = 'os_default'`. This works but is easy to get wrong from a new client,
which may write `manual` on first render and permanently pin the user's theme.
