# Implementation Plan: Link Previews In Chat

**Branch**: `046-chat-link-previews` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/046-chat-link-previews/spec.md`

## Summary

Both chat clients already render a preview card for a canonical link. The card is empty:
`PreviewAggregator` composes it from the URL alone, so a pasted task link produces
`Task 0199c4f2-8ab1-7c33-9e20-5f2b1a44d901`. This feature fills the card with real,
per-reader resource data, previews **every** supported link in a message instead of only
the first, and makes the cost of a rendered page proportional to distinct links rather
than to messages.

Three changes, in order of what they fix:

| # | Change | Fixes |
|---|---|---|
| 1 | `PreviewProvider` becomes batched, reader-scoped and `DBTX`-aware; each provider moves into the domain whose rows it reads and resolves them through one query whose access predicate is copied from the query that already owns that rule | empty cards (US1); the document and calendar **existence-only** access checks that would otherwise become disclosure |
| 2 | `GET /api/linking/preview?url=` is replaced by `POST /api/linking/previews` taking a list and answering `ok` / `unavailable` per URL; the clients fetch once per rendered page at the list level and cache per session | one request per message (US3); the single `unavailable` outcome FR-010 requires |
| 3 | Both cards render up to three cards per message, strip only the links that produced one, suppress a card duplicating a chat-to-task chip, and never fabricate a card from a URL | first-link-only (US2); the fabricated mobile fallback card |

No schema change, no migration, no new table, no new permission. Six new read queries, one
deleted endpoint, one deleted `packages/links` function, and the removal of the
URL-derived default preview — that default is the bug.

## Technical Context

**Language/Version**: Go 1.24 (backend, `go.work`); TypeScript 5.x (frontend monorepo, pnpm)

**Primary Dependencies**: Connect-RPC + protobuf for the RPC surface, but this feature's
endpoint is plain `net/http` JSON on the same mux as `/api/linking/{generate,resolve}`;
pgx/v5 + sqlc (`sqlc-gen-go-crud`); PostgreSQL 17; Next.js 15 + MUI v7 (web); Expo Router +
React Native (mobile)

**Storage**: PostgreSQL, schema-per-domain. **No schema change.** Six new read-only
queries across `collaboration`, `docs`, `calendar` and `chat`. No new index: every
predicate lands on a primary key (`id = ANY(...)` under `organization_id`) or on an
existing membership index.

**Testing**: `backend/integration/` (Go, `testWorld`); `frontend/apps/web/e2e/`
(Playwright); `frontend/apps/mobile/.maestro/` (Maestro)

**Target Platform**: Linux containers (Docker Swarm, ≥3 instances); web browsers; iOS and
Android via Expo

**Performance Goals**: one preview request per rendered page of messages, ≤6 queries in it
(one per resource type present). Message text must render without waiting on it (FR-022).

**Constraints**: ≤20 URLs per request (`400` beyond); ≤20 distinct URLs looked up per
rendered page; ≤3 cards per message; no server-side cache; nothing stored on the message.

**Scale/Scope**: 1 replaced HTTP endpoint, 1 changed Go interface, 6 preview providers (4
moved between packages, 5 rewritten), 6 new SQL queries, 1 new logic-layer method
(`ListEmployeeNames`), 1 new shared API module, 1 changed shared links module, 2 chat list
components + 2 message components + 1 document editor changed, 1 new integration suite,
1 new E2E suite, 1 new Maestro flow, 2 existing suites corrected.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Result both times: PASS.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Data governance & multi-tenancy** | every query pins `organization_id`; correct pool | **PASS** — all six queries lead with `organization_id` and take an id array; no cross-tenant read, so no `-- lint:cross-tenant` marker. The feature moves preview reads from `AdminPool` onto **`TenantPool`** (research D11); `AdminPool` is kept only for the pre-auth `tenantKey` → organization lookup on the global `public.organization` table. No DDL, so the `schema.sql`/`regen-schema.sh` step does not apply. |
| **II. Scenario-first testing** | integration + E2E scenarios derived from stories/FRs, approved before tasks | **PASS** — [contracts/test-scenarios.md](contracts/test-scenarios.md) maps all 3 user stories and all 24 FRs to `t.Run` stubs in `backend/integration/chat_link_previews_test.go` and Playwright stubs in `frontend/apps/web/e2e/chat-link-previews.spec.ts`, plus one Maestro flow, with exclusions documented. Two existing suites assert the behaviour being deleted and are corrected in the same change set. |
| **III. Two-layer architecture & proto authorization** | logic/connect split; `access_control` on every RPC | **PASS** — providers are logic-layer code taking `tx database.DBTX`; the connect layer (`linking.ConnectHandler`) owns authentication, pool selection and the request bound. No proto RPC is added, so no `access_control` option applies; authorization is the per-reader SQL predicate, evaluated per request. See Complexity Tracking for why this surface stays plain HTTP. |
| **IV. Cross-domain integration** | no cross-schema SQL; depend on logic interfaces | **PASS** — the four stub providers move out of `internal/linking` into `collaboration`, `docs`, `calendar` and `chat`; `internal/linking` keeps no preview SQL. Assignee names cross a domain boundary through the `EmployeeNameLookup` interface implemented by `internal/organization`, injected in `cmd/server.go`, never as a join. The one cross-schema join in `ListDocumentPreviews` (`document_access` → `organization.department_member`) is copied verbatim from `SearchDocuments` so the deny-precedence rule keeps a single definition; splitting it would create two interpretations of "may this reader read this document". |
| **V. Observability, simplicity & YAGNI** | `log/slog`, no premature optimisation | **PASS** — one `slog.InfoContext` per preview request (reader, url count, provider count, duration), one `slog.WarnContext` per failing provider. No cache server-side, no concurrency in the aggregator, no thumbnails, no external unfurling, no new permission id. Net deletion in `packages/links` and in both message components. |
| **VI. Versioning & breaking changes** | breaking changes ship atomically | **PASS** — the single-URL endpoint, `PreviewResponse`, `describeCanonicalResourceLink`, `getCanonicalLinkPreviewDisplay` and `LinkPreviewMetadata.Thumbnail` are **deleted**, not deprecated. Backend, web and mobile release together and all three callers are edited in this change set. |
| **VII. Frontend wrapper & type safety** | apps import `apis`, never `rpc`; `data-testid`; theme colours | **PASS** — the new `fetchCanonicalPreviews` lives in `packages/apis/src/linking.ts` and returns domain types, replacing three hand-rolled `fetch` calls with app-specific base-URL resolution. Cards keep their existing `data-testid="canonical-link-preview-card"` / `testID`; a card index suffix is added so a multi-card message is addressable. Web colours stay theme-derived. |
| **VIII. Cross-stack constants** | named constants, synchronised across layers | **PASS** — `MaxPreviewURLsPerRequest` (Go) / `MAX_PREVIEW_URLS_PER_REQUEST` (TS) and `MAX_PREVIEW_CARDS` are named constants; the card cap lives once in `packages/links` and is imported by both apps. `status` values (`ok`, `unavailable`) and `resourceType` values are existing string unions in `packages/links` matched by Go constants; the backend suite asserts the pair. |
| **IX. UUID v7 & nullable cursor params** | `sqlc.narg` for optional params | **PASS** — no pagination and no optional parameter; every query takes a required id array. |
| **X. Structured error details** | typed error details across the stack | **PASS** — a preview that cannot be produced is a **successful** response carrying `unavailable`, not an error, which is what FR-010 requires and what keeps one failing link from failing a page. The only error responses are `400` for a malformed or over-cap request. |
| **XI. Distributed-first** | stateless, no in-process state | **PASS** — previews are a pure read; nothing is cached, queued or held between requests on the server. The only cache is per client session and dies with the tab or the app. |
| **XII. Living documentation** | `docs/domain/` and `backend/docs/` updated in the same change set | **PASS** — `docs/domain/workspace-navigation.md` (endpoint table, resolution order, provider list), `chat.md` (what a message renders), `docs-knowledge.md` and `calendar.md` (previews are access-scoped, closing the existence-check gap) are updated as implementation tasks, not follow-ups. |
| **XIII. Mobile design & testing** | employee day-to-day scope; `testID`; Maestro; 360 dp | **PASS** — reading chat is day-to-day work, not administration. Cards keep `testID`, one Maestro flow covers the happy path, and multi-card layout is verified at 360 dp on Android as well as iOS. Mobile card colours stay the hard-coded palette shared by every component in `components/chat/`; introducing a mobile theme layer is out of scope for this feature. |

## Project Structure

### Documentation (this feature)

```text
specs/046-chat-link-previews/
├── plan.md                       # This file
├── research.md                   # Phase 0 — decisions D1–D12 and rejected alternatives
├── data-model.md                 # Phase 1 — derived entities, per-type content and access rules
├── quickstart.md                 # Phase 1 — how to run and validate the feature
├── contracts/
│   ├── link-preview-api.md       # HTTP endpoint, Go provider interface, TypeScript surface
│   ├── preview.query.sql         # the six new queries, exactly as they will land
│   └── test-scenarios.md         # Principle II behavioural contract
├── checklists/
│   └── requirements.md           # already written by /speckit-specify
└── tasks.md                      # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── internal/
│   ├── linking/
│   │   ├── types.go                          # CHANGED — LinkPreviewMetadata gains identifier/state/assignee/startTime; Thumbnail deleted
│   │   ├── preview.go                        # REWRITTEN — batched PreviewProvider, PreviewTarget, PreviewReader, aggregator; URL-derived default deleted; stub providers removed
│   │   ├── connect.go                        # CHANGED — POST /api/linking/previews; GET /api/linking/preview deleted
│   │   └── service.go                        # CHANGED — TenantPool for reads; PreviewBatch(ctx, reader, urls)
│   ├── collaboration/
│   │   ├── task_logic.go                     # REWRITTEN provider — real task card + EmployeeNameLookup
│   │   └── project_logic.go                  # NEW provider — project card
│   ├── docs/logic.go                         # REWRITTEN provider — document card with parent
│   ├── calendar/event_logic.go               # NEW provider — event card
│   ├── chat/logic.go                         # NEW provider — channel and thread cards
│   └── organization/logic.go                 # CHANGED — ListEmployeeNames over GetEmployeeCardsByIDs
├── database/scripts/
│   ├── collaboration.query.sql               # CHANGED — ListTaskPreviews, ListProjectPreviews
│   ├── docs.query.sql                        # CHANGED — ListDocumentPreviews
│   ├── calendar.query.sql                    # CHANGED — ListEventPreviews
│   └── chat.query.sql                        # CHANGED — ListChannelPreviews, ListThreadPreviews
├── cmd/server.go                             # CHANGED — provider wiring, tenant pool, EmployeeNameLookup injection
└── integration/
    ├── chat_link_previews_test.go            # NEW — behavioural contract
    └── canonical_links_test.go               # CHANGED — preview helper and assertions follow the new endpoint

frontend/
├── packages/
│   ├── apis/src/
│   │   ├── linking.ts                        # NEW — fetchCanonicalPreviews, session cache, cap constant
│   │   ├── token.ts                          # CHANGED — clearAuthToken clears the preview cache
│   │   └── index.ts                          # CHANGED — export the new module
│   └── links/src/index.ts                    # CHANGED — preview fields, MAX_PREVIEW_CARDS, per-url link stripping, display formatter; describeCanonicalResourceLink deleted
├── apps/web/src/app/workspace/
│   ├── chat/components/VirtualizedMessageList.tsx   # CHANGED — useCanonicalLinkPreviews, passes the map down
│   ├── chat/components/MessageItem.tsx              # CHANGED — N cards, chip suppression, no own fetch
│   └── docs/components/DocumentEditor.tsx           # CHANGED — one batched call, no fabricated fallback
├── apps/web/e2e/
│   ├── chat-link-previews.spec.ts            # NEW
│   └── canonical-resource-links.spec.ts      # CHANGED — the card no longer shows a uuid
└── apps/mobile/src/
    ├── components/chat/chat-message-body.tsx        # CHANGED — N cards from a prop, chip suppression, no own fetch
    ├── lib/canonical-links.ts                       # CHANGED — fetchCanonicalPreview deleted
    └── app/(app)/(chat)/[channelId].tsx, thread/[messageId].tsx   # CHANGED — page-level preview lookup
frontend/apps/mobile/.maestro/
└── chat-link-previews.yaml                   # NEW

docs/domain/
├── workspace-navigation.md                   # CHANGED — endpoints, resolution order, provider ownership
├── chat.md                                   # CHANGED — what a message renders for a canonical link
├── docs-knowledge.md                         # CHANGED — previews are access-scoped
└── calendar.md                               # CHANGED — previews honour event visibility
```

**Structure Decision**: the repository's existing shape — a Go Connect-RPC backend under
`backend/`, a pnpm monorepo under `frontend/` with `apps/web`, `apps/mobile` and shared
`packages/`. This feature adds no package and no proto file; every backend file above
already exists except the new integration suite, and the only new frontend file is one
shared API module.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The preview surface stays **plain HTTP JSON** rather than becoming a Connect RPC with a proto `access_control` declaration (Principle III's usual shape) | The three linking endpoints are one surface. `/api/linking/resolve` must answer unauthenticated link landings, which is why the surface is plain HTTP at all; moving one of the three into proto would split a coherent handler across two transports and two authentication paths for the same tenant/target logic. Authorization is not skipped — it is the per-reader SQL predicate on every read, which is stricter than a permission gate would be. | A proto `LinkPreviewService` gives generated types and a declarative permission, but the permission it could declare (`any authenticated caller`) is exactly what the handler already enforces, and it would leave `generate` and `resolve` behind on the old transport. Revisit if the whole linking surface is ever moved to proto. |
| `ListDocumentPreviews` contains a **cross-schema join** (`docs.document_access` → `organization.department_member`), which Principle IV says to avoid | It is copied verbatim from `SearchDocuments`, which owns the document access rule including the deny-grant precedence that an OR-chain silently loses. Re-expressing that rule in Go over two queries would create a second interpretation of "may this reader read this document" — and the first thing that drifts is the deny. | Fetching the reader's departments through the organization logic and passing the ids in would remove the join, but it makes the predicate a Go reimplementation of a rule that already exists correctly in SQL, and it costs a second round trip per request. Reconsider when the document access rule is factored into one shared SQL fragment for all three of its callers. |
