---

description: "Task list for feature 046 — Link Previews In Chat"
---

# Tasks: Link Previews In Chat

**Input**: Design documents from `/specs/046-chat-link-previews/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **INCLUDED and mandatory.** Constitution principle II makes
[contracts/test-scenarios.md](contracts/test-scenarios.md) an approved planning artifact
that precedes code. Every test task below writes the scenarios already named in that file
— it does not invent new ones. Write them first and confirm they fail.

**Organization**: grouped by user story so each can be implemented, tested and shipped
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `US1` · `US2` · `US3` — maps to the user stories in spec.md

## Path Conventions

Two-layer Go backend under `backend/`, pnpm monorepo under `frontend/` with `apps/web`,
`apps/mobile` and shared `packages/`. All paths below are repository-root-relative and,
except for the four new files explicitly marked NEW, already exist.

---

## Phase 1: Setup

**Purpose**: a working stack and a recorded baseline. There is no project to initialise —
this feature adds one shared TypeScript module and changes existing files everywhere else.

- [X] T001 Bring the stack up with the repository's own tooling per [quickstart.md](quickstart.md) — `make infra-up` then `make check-servers` — and confirm `cd backend && sqlc generate` leaves the tree clean before any edit, so a later diff is attributable to this feature
- [X] T002 [P] Record the baseline that must flip: run `make test-backend-one T=TestCanonicalLinks` and `pnpm --filter web exec playwright test e2e/canonical-resource-links.spec.ts`, and note in the task-work notes that both currently pass while asserting a preview title *contains a UUID* — the assertion this feature makes false (see [contracts/test-scenarios.md](contracts/test-scenarios.md) "changed, not added to")

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the batched, reader-scoped preview surface — wire shape, provider interface,
aggregator, endpoint and the shared client module. Every user story reads or writes
through this surface, so nothing else can start until it compiles.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

At the end of this phase the endpoint exists and answers correctly, but only `booking`
resolves — every other type is `unavailable`. That is a coherent, deployable state and the
checkpoint for this phase.

- [X] T003 Rewrite `LinkPreviewMetadata` in `backend/internal/linking/types.go`: add `Identifier`, `StateName`, `StateCategory`, `AssigneeName`, `StartTime` (RFC3339 string), `AllDay` with the JSON tags from [contracts/link-preview-api.md](contracts/link-preview-api.md), and **delete** the `Thumbnail` field outright (no deprecation — see plan Constitution Check VI)
- [X] T004 Rewrite the provider contract in `backend/internal/linking/preview.go`: add `PreviewTarget`, `PreviewReader`, the batched `PreviewProvider` interface (`Handles`, `Preview(ctx, tx database.DBTX, reader, targets)`) and the `MaxPreviewURLsPerRequest = 20` constant; **delete** the four URL-only stub providers and the URL-derived default preview branch — that default is the defect this feature closes (FR-006)
- [X] T005 Rewrite `PreviewAggregator` in `backend/internal/linking/preview.go` to group targets by the first provider that `Handles` their type, call each provider exactly once, merge results by `PreviewTarget.Key`, and on a provider error contribute nothing while logging `slog.WarnContext`; emit one `slog.InfoContext` per request carrying reader, url count, provider-call count and duration (the count US3's cost assertion observes)
- [X] T006 Implement `NewBookingPreviewProvider()` in `backend/internal/linking/preview.go` — generic card, no row read, no `DBTX` use — so `internal/linking` owns no preview SQL (Principle IV) while one type still resolves at this checkpoint
- [X] T007 Replace the endpoint in `backend/internal/linking/connect.go`: register `POST /api/linking/previews` beside `generate` and `resolve`, **delete** `GET /api/linking/preview?url=` and the `PreviewResponse` type, and implement the seven-step handler order from [contracts/link-preview-api.md](contracts/link-preview-api.md) — decode, authenticate (no principal ⇒ every item `unavailable` with **no database access**), normalise, resolve tenant keys, drop foreign-tenant targets, run providers, assemble in request order; `400` for a malformed body, an empty `urls` or more than `MaxPreviewURLsPerRequest`, `405` for a non-`POST`
- [X] T008 Update `backend/internal/linking/service.go` to expose `PreviewBatch(ctx, reader, urls)`, running provider reads on **`TenantPool`** and keeping `AdminPool` solely for the pre-auth `tenantKey` → organization lookup on the global `public.organization` table (research D11)
- [X] T009 [P] Update `frontend/packages/links/src/index.ts`: extend `CanonicalLinkPreview` with `identifier`, `stateName`, `stateCategory`, `assigneeName`, `startTime`, `allDay`, drop `thumbnail`, and **delete** `describeCanonicalResourceLink`, `getCanonicalLinkPreviewDisplay` and `CanonicalPreviewResponse` — they exist only to fabricate a card from a URL
- [X] T010 [P] Create `frontend/packages/apis/src/linking.ts` (NEW) with `MAX_PREVIEW_URLS_PER_REQUEST = 20`, the `LinkPreviewItem` type and `fetchCanonicalPreviews(urls)` posting one batch request and returning `Map<string, CanonicalLinkPreview>`; it must never throw — a failed lookup resolves to an empty map (FR-015, FR-023). Session caching is deliberately **not** here yet; it lands in US3 (T048)
- [X] T011 Export the new module from `frontend/packages/apis/src/index.ts` so both apps import through `apis` and never hand-roll a `fetch` (Principle VII)
- [X] T012 [P] Create `backend/integration/chat_link_previews_test.go` (NEW) with `TestChatLinkPreviews` and the 21-row `testWorld` fixture from [contracts/test-scenarios.md](contracts/test-scenarios.md) — four employees, two projects, five tasks, three documents, three events, two channels, one thread root, one foreign organization — plus the HTTP helper that posts to `/api/linking/previews` with a dev JWT. Fixture only; scenario bodies land per story
- [X] T013 Move the preview helper in `backend/integration/canonical_links_test.go` onto the batch endpoint so the existing suite compiles against the new surface; leave its *assertions* untouched here — flipping them is T037, and they must be seen failing first

**Checkpoint**: `go build ./...`, `pnpm -w typecheck` and `make test-backend-one T=TestChatLinkPreviews` all run. `POST /api/linking/previews` answers, booking previews resolve, every other type is `unavailable`, and no card anywhere shows a UUID because no card is fabricated any more.

---

## Phase 3: User Story 1 — Recognize The Linked Work Without Opening It (Priority: P1) 🎯 MVP

**Goal**: fill the card with real, per-reader resource data. A pasted task link names the
task, its identifier, its state and its assignee; a document link names the document and
where it lives; an event link names the event and when it is.

**Independent Test**: paste a canonical task link into a channel and confirm the card names
the task, its identifier, its state and its assignee, matching the task detail screen for
the same task at the same moment. Repeat for a document and an event link. Then repeat as
a reader without access and confirm a raw clickable link and no card.

**Scope note**: this story keeps the existing *per-message, first-link-only* fetch shape —
it just routes through the batch endpoint and renders real content. Multi-link rendering is
US2; list-level lookup and caching is US3. That is what makes each story shippable alone.

### Tests for User Story 1 ⚠️ Write first, confirm they fail

- [X] T014 [P] [US1] Add the `when a task link is previewed by someone who can see the task` block to `backend/integration/chat_link_previews_test.go` — title not identifier, identifier/state/assignee, badgeable type, `+N` for a second assignee, current state after a state change, identifier fallback for an empty title (FR-001, FR-006, FR-007, FR-008, SC-002, SC-007)
- [X] T015 [P] [US1] Add the `when a document link is previewed` block to `backend/integration/chat_link_previews_test.go` — title plus parent title, and the workspace name for a root document (FR-002)
- [X] T016 [P] [US1] Add the `when a calendar event link is previewed` block to `backend/integration/chat_link_previews_test.go` — title plus a localisable instant, the all-day marker, and nothing for a cancelled event (FR-003, FR-010)
- [X] T017 [P] [US1] Add the `when a project, channel or thread link is previewed` block to `backend/integration/chat_link_previews_test.go` — project name, channel name, parent channel name plus thread indication, and that nothing is drawn from the thread's messages (FR-004, FR-005)
- [X] T018 [P] [US1] Add the `when the reader is not entitled to the linked resource` block to `backend/integration/chat_link_previews_test.go` — private-project task, explicitly denied document, private event, private channel, deleted task, never-existed resource, **byte-identical** denied and missing responses, unauthenticated request, foreign tenant key (FR-009, FR-010, FR-012, SC-004)
- [X] T019 [P] [US1] Add the `when two readers request the same link` and `when the resource type is booking` blocks to `backend/integration/chat_link_previews_test.go` (FR-011, FR-008)
- [X] T020 [P] [US1] Create `frontend/apps/web/e2e/chat-link-previews.spec.ts` (NEW) with the US1 blocks from [contracts/test-scenarios.md](contracts/test-scenarios.md) — the card names the task and state and shows no UUID, activating it opens the task in-app, a title containing markup characters renders as plain text, and an inaccessible resource yields no card and no error with the raw link still clickable (FR-001, FR-015, FR-017, FR-019, SC-001, SC-002, SC-004, SC-008)

### SQL for User Story 1

Every query leads with `organization_id` and takes a required id array; no `sqlc.narg`, no
new index, no DDL. Copy each from [contracts/preview.query.sql](contracts/preview.query.sql) verbatim.

- [X] T021 [P] [US1] Add `ListTaskPreviews` and `ListProjectPreviews` to `backend/database/scripts/collaboration.query.sql` — task title/identifier/state via `project_state`, earliest `role = 'assignee'` plus a count, `is_deleted = FALSE`, and the public-or-membership access predicate `SearchTasks` already owns
- [X] T022 [P] [US1] Add `ListDocumentPreviews` to `backend/database/scripts/docs.query.sql`, copying the `COALESCE` precedence chain from `SearchDocuments` verbatim — owner, explicit employee grant including an explicit `none` deny that stops the chain, highest inherited department grant, then `visibility = 'public'` — and reading the parent title only for a visible child (plan Complexity Tracking documents why this cross-schema join stays)
- [X] T023 [P] [US1] Add `ListEventPreviews` to `backend/database/scripts/calendar.query.sql` — title, `start_time`, `all_day`, `cancelled_at IS NULL`, and the organiser-or-attendee-or-`team`/`org_wide` predicate from `SearchEvents`
- [X] T024 [P] [US1] Add `ListChannelPreviews` and `ListThreadPreviews` to `backend/database/scripts/chat.query.sql` — `display_name` with a `title_slug` fallback, `is_archived = FALSE`, the public-or-membership predicate from `SearchChannels`, and the thread variant keyed by root message id with `is_deleted = FALSE`
- [X] T025 [US1] Run `cd backend && sqlc generate` and commit the generated Go for all six queries (depends on T021–T024; `backend/database/scripts/schema.sql` is untouched — this feature has no migration)

### Backend logic for User Story 1

- [X] T026 [US1] Add `ListEmployeeNames(ctx, tx, orgID, ids)` to `backend/internal/organization/logic.go` over the existing `GetEmployeeCardsByIDs`, returning `map[dbuuid.UUID]string`
- [X] T027 [US1] In `backend/internal/collaboration/task_logic.go` declare the local `EmployeeNameLookup` interface (declared here, not in `organization`, to avoid an import cycle — research D5) and implement `NewTaskPreviewProvider(queries, employeeNames)` handling `task`: one `ListTaskPreviews` call, one batched name lookup, title→identifier→type-name fallback chain, never a UUID (depends on T025, T026)
- [X] T028 [P] [US1] Implement `NewProjectPreviewProvider(queries)` in `backend/internal/collaboration/project_logic.go` handling `project` — name as title, `key` as identifier and supporting line (depends on T025)
- [X] T029 [P] [US1] Implement `NewDocumentPreviewProvider(queries)` in `backend/internal/docs/logic.go` handling `document` — title plus parent title, or the workspace at the root (depends on T025)
- [X] T030 [P] [US1] Implement `NewEventPreviewProvider(queries)` in `backend/internal/calendar/event_logic.go` handling `calendar` — title, `start_time` as RFC3339, `all_day` (depends on T025)
- [X] T031 [P] [US1] Implement `NewChatPreviewProvider(queries)` in `backend/internal/chat/logic.go` handling both `chat` and `thread` — channel display name, and the parent channel name with a `Thread` badge for a thread; reads exactly one row and never renders messages, which closes the recursion edge case by construction (depends on T025)
- [X] T032 [US1] Wire the six providers into the aggregator in `backend/cmd/server.go`, inject `internal/organization` as the `EmployeeNameLookup` implementation, and confirm preview reads take `TenantPool` (depends on T027–T031)

### Client rendering for User Story 1

- [X] T033 [US1] Implement `buildCanonicalLinkPreviewDisplay(preview)` in `frontend/packages/links/src/index.ts` — the single place a card's text is composed so web and mobile always agree; per-type composition from [contracts/link-preview-api.md](contracts/link-preview-api.md), segments omitted when absent, `Intl.DateTimeFormat` for the event start with the date alone when `allDay`, `+N` appended for extra assignees, output bounded to at most two already-truncated lines
- [X] T034 [US1] Update `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` to call `fetchCanonicalPreviews` from `apis` (replacing its inline `fetch`) and render its card from `buildCanonicalLinkPreviewDisplay`, keeping `data-testid="canonical-link-preview-card"` and theme-derived colours, and rendering all resource-supplied text as plain text never as markup (FR-019)
- [X] T035 [US1] Update `frontend/apps/mobile/src/components/chat/chat-message-body.tsx` the same way and **delete** `fetchCanonicalPreview` from `frontend/apps/mobile/src/lib/canonical-links.ts`; the mobile card must no longer fabricate a fallback card from the URL, keeps its `testID`, and keeps the hard-coded `components/chat/` palette
- [X] T036 [US1] Update `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` to make one batched `fetchCanonicalPreviews` call in place of its per-URL `Promise.all` loop, and delete its fabricated-from-URL fallback card
- [X] T037 [US1] Flip the assertion in `backend/integration/canonical_links_test.go`: the preview title is the task's **title** and contains no UUID (was `require.Contains(t, preview.Preview.Title, task.Id)`). Correct it — do not silence it
- [X] T038 [US1] Flip the assertion in `frontend/apps/web/e2e/canonical-resource-links.spec.ts`: the card contains the task title and identifier and **not** the UUID (was `expect(previewCard).toContainText(taskId)`)

**Checkpoint**: a pasted task, document, event, project, channel or thread link renders a card carrying real content, scoped to the reader; a reader without access sees a raw clickable link and nothing else. US1 is independently demoable and is the MVP.

---

## Phase 4: User Story 2 — See Every Resource A Message Links (Priority: P2)

**Goal**: every supported link in a message previews, up to a cap of three, in the order the
links appear — not only the first.

**Independent Test**: post one message containing a task link, a document link and an event
link and confirm three distinct cards render in text order; post a message with more links
than the cap and confirm the overflow stays raw clickable text.

### Tests for User Story 2 ⚠️ Write first, confirm they fail

- [X] T039 [P] [US2] Add the `when one request carries several links` block to `backend/integration/chat_link_previews_test.go` — every accessible link resolved in one request, items in request order echoing each URL, accessible and inaccessible answered independently, a malformed URL and an unsupported resource type each `unavailable` without failing the batch, over-bound rejected outright, the same URL twice looked up once and answered twice (FR-013, FR-014, FR-020, FR-023, FR-024, SC-005, SC-008)
- [X] T040 [P] [US2] Add the multi-link blocks to `frontend/apps/web/e2e/chat-link-previews.spec.ts` — three cards in text order, each carded URL removed from the body, the same link twice producing one card, the first three previewing with the rest clickable, an accessible-plus-inaccessible pair, and a conversion chip suppressing the duplicate card (FR-013–FR-016, FR-018, SC-003)

### Implementation for User Story 2

- [X] T041 [US2] In `frontend/packages/links/src/index.ts` export `MAX_PREVIEW_CARDS = 3` (one definition, imported by both apps — Principle VIII) and change `removeCanonicalResourceLinksFromContent(rawContent, urls)` to strip **only** the URLs that produced a card, leaving every other link as raw text (FR-016, research D10)
- [X] T042 [US2] Update `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` to render up to `MAX_PREVIEW_CARDS` cards in text order, de-duplicating repeated canonical resources within the message to one card, and stripping only the carded URLs from the body; add a card-index suffix to `data-testid` so a multi-card message is addressable
- [X] T043 [US2] Suppress a preview card in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` for any task the message already displays as a chat-to-task conversion chip — the chip is the authoritative representation (FR-018)
- [X] T044 [US2] Apply the same N-card rendering, in-message de-duplication, cap, per-URL stripping and chip suppression to `frontend/apps/mobile/src/components/chat/chat-message-body.tsx`, with `testID` index suffixes matching web
- [X] T045 [US2] Create `frontend/apps/mobile/.maestro/chat-link-previews.yaml` (NEW): sign in, open a channel seeded with a message carrying a task link and a document link, assert both `canonical-link-preview-card` testIDs are visible, assert the first shows the task title and identifier, tap it and assert the task screen opens (Principle XIII — happy path only)

**Checkpoint**: US1 and US2 both work. A three-link handoff message communicates its whole set; overflow and inaccessible links stay clickable text; a chip is never doubled by a card.

---

## Phase 5: User Story 3 — Read A Busy Channel Without Waiting On Previews (Priority: P3)

**Goal**: the cost of a rendered page is proportional to distinct links, not to messages,
and message text never waits on a preview.

**Independent Test**: open a channel whose visible page holds fifty messages linking five
distinct resources; confirm the list renders immediately, cards fill in progressively, and
exactly one preview request is issued.

### Tests for User Story 3 ⚠️ Write first, confirm they fail

- [X] T046 [P] [US3] Add the busy-channel blocks to `frontend/apps/web/e2e/chat-link-previews.spec.ts` — messages readable before any card resolves, cards filling in without moving the message the reader is on, fifty messages over five resources issuing **one** request (counted with `page.route`/`waitForRequest` on `**/api/linking/previews`), every message linking the same resource showing a card, and a card disappearing on the next render when its link is edited out (FR-007, FR-020–FR-022, SC-005, SC-006)
- [X] T047 [P] [US3] Add the cost assertion to `backend/integration/chat_link_previews_test.go`: a request carrying 20 links spanning 5 distinct resources of 3 types resolves in **three** provider calls, observed through the aggregator's `slog` line rather than a test-only hook (SC-005)

### Implementation for User Story 3

- [X] T048 [US3] Add the session cache and in-flight de-duplication to `frontend/packages/apis/src/linking.ts`, keyed by canonical URL and held for the life of the session, plus `clearCanonicalPreviewCache()`; a resource linked from twenty messages is looked up once (FR-021, research D8). No server-side cache — a cache keyed by reader entitlement is a correctness hazard
- [X] T049 [US3] Call `clearCanonicalPreviewCache()` from `clearAuthToken()` in `frontend/packages/apis/src/token.ts`, so the reader-scoped cache cannot outlive its reader
- [X] T050 [US3] Implement `useCanonicalLinkPreviews(messages)` in `frontend/apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx` — collect distinct canonical URLs across the rendered page up to `MAX_PREVIEW_LOOKUP = 20`, issue one request, return a `Map<url, preview>` and pass it down; the list must render message text without awaiting it (FR-022)
- [X] T051 [US3] Change `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` to take the preview map as a prop and fetch nothing itself, so a failed or slow lookup for one link cannot block another message (FR-023)
- [X] T052 [US3] Add the page-level preview lookup to `frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx`, mirroring T050 including the `MAX_PREVIEW_LOOKUP` cap
- [X] T053 [US3] Add the page-level preview lookup to `frontend/apps/mobile/src/app/(app)/(chat)/thread/[messageId].tsx`
- [X] T054 [US3] Change `frontend/apps/mobile/src/components/chat/chat-message-body.tsx` to take the preview map as a prop and fetch nothing itself (depends on T052, T053)

**Checkpoint**: all three stories are independently functional. A busy channel opens as fast as before the feature and issues one preview request per rendered page.

---

## Phase 6: Polish & Cross-Cutting Concerns

Principle XII makes the documentation tasks part of the Definition of Done, not follow-ups.

- [X] T055 [P] Update `docs/domain/workspace-navigation.md` — the endpoint table (`POST /api/linking/previews`, the deleted `GET /api/linking/preview`), the seven-step resolution order, and the provider-ownership table now that each provider lives in the domain whose rows it reads
- [X] T056 [P] Update `docs/domain/chat.md` — what a message renders for a canonical link: up to three per-reader cards in text order, chip suppression, raw text for anything unavailable
- [X] T057 [P] Update `docs/domain/docs-knowledge.md` — document previews are access-scoped through the `SearchDocuments` precedence chain, closing the previous existence-only check
- [X] T058 [P] Update `docs/domain/calendar.md` — event previews honour event visibility and exclude cancelled events, closing the previous existence-only check
- [X] T059 Run `make lint-tenancy` — four schema query files changed and every new predicate must pin `organization_id`
- [X] T060 Run `make test-backend` in full (not just `T=TestChatLinkPreviews`) and confirm `TestCanonicalLinks` passes on its corrected assertion
- [X] T061 [P] Run the web lint, typecheck and full Playwright suite; confirm no app imports `rpc` directly and no hand-rolled preview `fetch` survives (Principle VII)
- [X] T062 [P] Verify multi-card layout on mobile at 360 dp on **Android** as well as iOS, and run `frontend/apps/mobile/.maestro/chat-link-previews.yaml` on both. Done: the flow passes end to end on an Android emulator (checked at 360 dp by overriding the density to 480, since the emulator's default 420 dpi is 411 dp) and on an iPhone SE simulator. Getting there fixed three real defects — see implementation-notes.md
- [X] T063 Walk [quickstart.md](quickstart.md) end to end, including the by-hand `curl` checks: two items in request order, an unauthenticated request returning `200` with every item `unavailable`, and a non-member's response byte-identical to the not-found response

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**. The provider interface change (T004) breaks every call site at compile time, which is the point: the compiler enumerates what must stop composing a card from a URL
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on Phase 2. Independently testable, but only meaningful to demo after US1 — three empty cards are not an improvement on one
- **US3 (Phase 5)**: depends on Phase 2. Technically independent of US1 and US2; T051/T054 edit the same two components as T042/T044, so if US2 and US3 run concurrently those four tasks must be sequenced by one owner
- **Polish (Phase 6)**: depends on every story that is being shipped

### Within Each User Story

- Tests are written and seen failing before implementation
- SQL → `sqlc generate` → providers → server wiring → client rendering
- T025 (`sqlc generate`) blocks T027–T031; T027 also needs T026
- T032 needs all six providers
- T033 blocks T034, T035 and T036
- T041 blocks T042 and T044
- T048 blocks T050, T052 and T053

### File-contention warnings (do not mark these [P])

- `backend/internal/linking/preview.go` — T004, T005, T006
- `backend/internal/collaboration/task_logic.go` — T027 only, but T027 and T028 sit in the same package and share the generated `queries` type
- `frontend/packages/links/src/index.ts` — T009, T033, T041
- `frontend/packages/apis/src/linking.ts` — T010, T048
- `frontend/apps/web/.../MessageItem.tsx` — T034, T042, T043, T051
- `frontend/apps/mobile/.../chat-message-body.tsx` — T035, T044, T054
- `backend/integration/chat_link_previews_test.go` — T012, then T014–T019, T039, T047. These are marked [P] because they are separate top-level `t.Run` blocks appended to one file: parallel **authorship** is fine, the merge is not. One owner appends, or they land sequentially

### Parallel Opportunities

- T009, T010 and T012 run alongside the backend work in Phase 2
- The six US1 backend test blocks (T014–T019) and the web E2E (T020) are six-way parallel
- The four SQL tasks (T021–T024) are four-way parallel — different schema files
- Four of the five providers (T028–T031) are parallel once `sqlc generate` has run
- The four `docs/domain/` updates (T055–T058) are four-way parallel
- With three developers after Phase 2: A takes US1, B takes US2, C takes US3, with the `MessageItem.tsx` / `chat-message-body.tsx` contention above resolved by B and C sharing an owner for those files

---

## Parallel Example: User Story 1

```bash
# The six backend scenario blocks, authored together against the T012 fixture:
Task: "task preview scenarios in backend/integration/chat_link_previews_test.go"
Task: "document preview scenarios in backend/integration/chat_link_previews_test.go"
Task: "calendar preview scenarios in backend/integration/chat_link_previews_test.go"
Task: "project/channel/thread scenarios in backend/integration/chat_link_previews_test.go"
Task: "entitlement and disclosure scenarios in backend/integration/chat_link_previews_test.go"
Task: "two-reader and booking scenarios in backend/integration/chat_link_previews_test.go"

# The four SQL files, genuinely parallel:
Task: "ListTaskPreviews + ListProjectPreviews in backend/database/scripts/collaboration.query.sql"
Task: "ListDocumentPreviews in backend/database/scripts/docs.query.sql"
Task: "ListEventPreviews in backend/database/scripts/calendar.query.sql"
Task: "ListChannelPreviews + ListThreadPreviews in backend/database/scripts/chat.query.sql"

# The five providers, after `sqlc generate`:
Task: "NewProjectPreviewProvider in backend/internal/collaboration/project_logic.go"
Task: "NewDocumentPreviewProvider in backend/internal/docs/logic.go"
Task: "NewEventPreviewProvider in backend/internal/calendar/event_logic.go"
Task: "NewChatPreviewProvider in backend/internal/chat/logic.go"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — **critical**, blocks everything
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: paste a task, document and event link into a channel as two
   readers with different access; confirm real content for one and a raw link for the other
5. Ship. This alone closes the user's complaint: a pasted task link is no longer bare text

### Incremental Delivery

1. Setup + Foundational → the batch surface exists; only `booking` resolves; no card
   anywhere fabricates a UUID title
2. + US1 → every supported link previews with real, per-reader content **(MVP)**
3. + US2 → every link in a message previews, up to three, chip-aware
4. + US3 → one request per rendered page, session-cached, never blocking message text

Each increment is deployable and none breaks the one before it.

### Notes

- `[P]` means different files and no dependency on an incomplete task — check the
  file-contention list above before running two tasks concurrently
- No migration, no schema change, no new table, no new permission id. If a task seems to
  need one, the design has drifted from [plan.md](plan.md) — stop and reconcile
- Prefer deletion: this feature removes one endpoint, one response type, two
  `packages/links` functions, one mobile fetch helper, the `thumbnail` field and the
  URL-derived default preview. If the diff is not net-negative in `packages/links` and in
  both message components, something extra was added
- Commit after each task or logical group
