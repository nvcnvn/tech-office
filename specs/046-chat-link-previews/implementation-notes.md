# Implementation notes — feature 046

## T002 baseline (recorded before any edit)

Run on 2026-09-04, before the first source change:

- `make test-backend-one T=TestCanonicalLinks` — **PASS**. The subtest
  `when preview metadata is requested for an internal canonical link / it returns
  preview metadata when the target is available` passes on
  `require.Contains(t, preview.Preview.Title, task.Id)`
  (`backend/integration/canonical_links_test.go:279`) — the preview title *contains the
  task UUID*. That is the assertion this feature makes false.
- `frontend/apps/web/e2e/canonical-resource-links.spec.ts:186` asserts
  `expect(previewCard).toContainText(taskId)` — the same defect on the web side.

[ASSUMPTION: the Playwright baseline was verified by reading the assertion rather than by
executing the suite, because the web dev server was not running at the point the baseline
was taken and starting it changes nothing about the assertion's text. The suite is run for
real in T061, after the assertion is corrected in T038.]

- `cd backend && sqlc generate` leaves the tree clean, so any later diff under
  `backend/database/` is attributable to this feature.

## Decisions taken during implementation

These resolve places where the plan or the contract left a choice open, or where the code
disagreed with the contract. Each is flagged for review.

- **`assigneeCount` added to the wire.** [ASSUMPTION: `contracts/link-preview-api.md`
  lists `assigneeName` but no count, while `data-model.md` says the `+N` suffix is
  "appended by the client formatter" and the test scenarios require "the second assignee
  count rather than listing everyone". A client formatter cannot compute `+N` without the
  count, so `LinkPreviewMetadata.AssigneeCount` / `CanonicalLinkPreview.assigneeCount` was
  added. The alternative — composing `"Mai Anh Nguyen +1"` server-side — would put display
  composition back on the server, which D7 explicitly moved to `packages/links`.]

- **`ListTaskPreviews` uses `LEFT JOIN LATERAL` plus `COALESCE` for the assignee id.**
  [ASSUMPTION: `contracts/preview.query.sql` reads the earliest assignee as a scalar
  sub-select. sqlc infers that column as non-nullable `dbuuid.UUID`, and `dbuuid.UUID`
  refuses to scan a real NULL — so an unassigned task would fail the whole batch. A
  `CASE ... END` made sqlc emit `interface{}`, which is worse. The query therefore keeps
  the one-row-per-task shape through a `LEFT JOIN LATERAL ... LIMIT 1` and coalesces the id
  to the nil uuid; the Go side reads `assignee_count`, not the id, to decide whether there
  is an assignee. The access predicate is unchanged.]

- **`LinkResolutionResult.Preview` deleted, not left unset.** [ASSUMPTION: the plan says
  previews move to their own endpoint but does not say what happens to the preview field
  `Resolve` used to populate from the URL. No client reads it, and leaving a field nothing
  sets is exactly the dead surface the feature is removing, so it was deleted from the Go
  struct and from the TypeScript `CanonicalLinkResolution`.]

- **Card `data-testid` / `testID` is indexed: `canonical-link-preview-card-{n}`.** T042
  asks for an index suffix so a multi-card message is addressable. The two existing
  selectors were updated in the same change set:
  `e2e/canonical-resource-links.spec.ts` and `.maestro/canonical-resource-links.yaml`.

- **Header-only authentication on `POST /api/linking/previews`.** The contract says there
  is no `?token=` fallback; `AuthenticateHTTPRequest` has one, so the handler only
  authenticates when an `Authorization` header is present.

- **The web list collects urls newest-first.** [ASSUMPTION: the contract says the list
  collects "distinct canonical URLs across the rendered page (cap `MAX_PREVIEW_LOOKUP`)"
  without saying which end the cap is spent from. Web's `messages` are oldest-first and a
  reader opens a channel at the bottom, so filling from the front left a just-posted
  message without a card — caught by the E2E suite. It now fills from the tail, matching
  what `useMessageTaskLinks` already does with `.slice(-N)`. Mobile holds messages
  newest-first and fills from the front, which is the same rule.]

- **`splitTextByCanonicalResourceLinks` no longer returns the whole text when every link
  was omitted.** Its "no segments produced" fallback could not tell "nothing matched" from
  "everything matched and was omitted", so a message whose entire body was one canonical
  link kept its raw URL *underneath* the card. This predates the feature but FR-016 makes
  it in scope. Fixed with an explicit `matchedCanonicalLink` flag.

- **The SC-005 cost assertion runs the aggregator in-process.**
  [ASSUMPTION: `contracts/test-scenarios.md` asks for the provider-call count to be
  observed "through the `slog` line the aggregator writes". The integration suite talks to
  a separately started server whose stdout it cannot read, so the count is asserted by
  driving the shipped `linking.PreviewAggregator` with the same six providers
  `cmd/server.go` wires. No production code grew a test-only hook, and the number asserted
  is the number the aggregator reports in that log line.]

- **`e2e/chat-link-previews.spec.ts` follows the card's `href` by navigation rather than by
  clicking it.** A click is a cross-document load, and the Next dev server answers one
  mid-compile with its "missing required error components" placeholder. The test asserts
  the card's `href` is the canonical URL and then navigates to it, which is the same claim
  without the harness flake.

- **The three preview cards in `DocumentEditor` and the mobile document viewer** were also
  migrated, and `fetchCanonicalPreview` deleted from `apps/mobile/src/lib/canonical-links.ts`.
  `apps/mobile/src/app/(app)/(more)/docs/[slug].tsx` was a fourth caller of the deleted
  endpoint that the plan's file list did not name; it now uses the shared hook and no
  longer fabricates a card from a URL.

## Pre-existing failures, untouched by this feature

- `pnpm typecheck:mobile` reports three errors, all in code this feature did not write:
  `(app)/(chat)/[channelId].tsx:1601` (`number` vs `bigint` on an optimistic
  `updatedAt`), `(app)/(chat)/index.tsx:356` (`"tabPress"` event name), and
  `components/chat/chat-message-body.tsx:275` (`VoiceMessagePlayer` has no `durationMs`
  prop). All three are present verbatim on `HEAD`; confirmed with `git show`.
- `make test-frontend-one F=<spec>` passes `--config=apps/web/e2e/playwright.config.ts`
  while already running inside `apps/web`, so the path never resolves. Run specs with
  `pnpm --filter web exec playwright test --config=e2e/playwright.config.ts <spec>` until
  the Makefile is corrected. Out of scope here.

## Card selection is shared, not duplicated

`selectCanonicalPreviewCards` in `packages/links` decides which of a message's links become
cards — resolved-for-this-reader, one per distinct resource, none for a chipped task, at
most `MAX_PREVIEW_CARDS`, in text order. Web and mobile call it from a `useMemo` and render
the result. The first cut had that rule written twice, once per app; two copies of
"which links become cards" is the same drift risk the plan already cites as the reason
`buildCanonicalLinkPreviewDisplay` lives in the shared package.

On the note in tasks.md that the diff should be net-negative in `packages/links` and in both
message components: it is net-negative in both message components
(`MessageItem.tsx` +27/−68, `chat-message-body.tsx` +42/−53) and in
`apps/mobile/src/lib/canonical-links.ts` (+0/−16). `packages/links/src/index.ts` is
**net-positive** (+186/−56): it gained the display formatter and the card-selection rule
that the two apps used to carry, and lost the two URL-fabricating functions. That is the
intended direction — the composition moved into the shared package rather than
disappearing — but the note's expectation is not met there, and it is called out here
rather than quietly.

## Verification results

| Check | Result |
|---|---|
| `make test-backend` (whole suite) | **PASS** — 146 top-level tests, 0 failures, 83s |
| `make test-backend-one T=TestChatLinkPreviews` | **PASS** — 34 scenarios |
| `make test-backend-one T=TestCanonicalLinks` | **PASS** on the corrected assertion |
| `make lint-tenancy` | **PASS** — 552 queries checked, no new deferral |
| `pnpm --filter web exec tsc --noEmit` | **PASS** |
| `eslint` on every changed frontend file | **PASS** |
| `e2e/chat-link-previews.spec.ts` (11) + `canonical-resource-links.spec.ts` (6) | **PASS** — 17/17 |
| `make test-frontend` (whole suite, 215 tests) | 206 passed, **6 failed** (4 distinct), 4 did not run |
| `pnpm typecheck:mobile` | 3 errors, all pre-existing on `HEAD` (see above) |
| Maestro `chat-link-previews.yaml` | **PASS** on Android (incl. at 360 dp) and on iPhone SE |

### The four full-suite web failures

All four pass or are unrelated when looked at directly:

- `canonical-resource-links.spec.ts:129` "the browser lands on the correct web task
  destination" — **passes in isolation**, three times, including after the final refactor.
  It fails only under full-suite load, where a cross-document navigation can catch the Next
  dev server mid-compile and get its "missing required error components" placeholder. Same
  class of harness flake that made the new suite's click test unstable until it was changed
  to navigate rather than click.
- `legal-surface.spec.ts:59` "they cannot proceed without acknowledging the terms"
- `ritual-submission-flow.spec.ts:355` "a dual-role owner still sees both proof submission
  and review controls"
- `user-guide-screenshots.spec.ts:626` "sign-in screens"

The last three are in surfaces this feature does not touch — terms acknowledgement on
sign-up, ritual submission controls, and the screenshot generator. They were not
investigated further; if the suite is expected green on `main`, they are worth a separate
look.

### Mobile (T062) — completed, and it found three real defects

The flow now passes end to end on both platforms: on the connected Android emulator via
`make test-mobile-one F=chat-link-previews`, and on a booted iPhone SE (3rd generation)
simulator via the same Maestro invocation with `--device <udid>`. The 360 dp check was
done on Android by overriding the density (`adb shell wm density 480` against the 1080 px
panel, then `adb shell wm density reset`) — the emulator's stock 420 dpi is 411 dp, not
360, so running it as-is would not have been the check T062 asks for. At 360 dp both cards
render inside the bubble with no clipping and no horizontal overflow, and the iPhone SE at
375 pt is the same.

Getting the flow green required fixing three defects that the desktop suites could not see.
All three predate this feature but sit squarely on FR-017, so they were fixed rather than
recorded:

- **The mobile route for a task was missing its `task` segment.**
  `buildMobileRoute` in `backend/internal/linking/service.go` produced
  `/(app)/(tasks)/{projectId}/{taskId}`, but the screen is
  `app/(app)/(tasks)/[projectId]/task/[taskId].tsx`. Expo Router matched nothing and
  dropped the reader at the app root, which renders as the sign-in screen — so tapping a
  task preview card looked exactly like being signed out. Fixed at the one place that
  builds the route, which is also the path notification deep links take; the assertion in
  `backend/integration/canonical_links_test.go` moved with it.

- **The document viewer could not open a document by id.**
  `app/(app)/(more)/docs/[slug].tsx` always sent its route segment as `slug`, but canonical
  links and notification deep links supply a document **id**, so the card opened onto
  "[not_found] slug not found". `GetDocument` already accepts either, so the screen now
  picks the field from the shape of the segment — one guard where every caller converges,
  rather than making each caller resolve an id to a slug. Note the shape test is
  deliberately version-agnostic: this repository issues UUIDv7, and the `[1-5]` version
  nibble that `hooks/use-resolved-project-id.ts` uses would reject every id it is given.
  That other copy is left alone as out of scope, but it is wrong in the same way.

- **`packages/apis` had an import cycle through `token.ts`.**
  T049 had `clearAuthToken()` import `clearCanonicalPreviewCache` from `linking.ts`, which
  imports `token.ts` and `rpc.ts` back — Metro logged
  `Require cycle: token.ts -> linking.ts -> rpc.ts -> token.ts` on every cold start, with
  its usual warning about uninitialised values. The cache is now scoped to the reader from
  inside `linking.ts`: it records the token it was filled for and empties itself when that
  token changes, and a generation counter stops an in-flight response from writing into the
  next reader's cache. `clearCanonicalPreviewCache` is deleted, `token.ts` imports nothing
  new, and the scoping is strictly stronger than before because it also covers a token swap
  that never passed through sign-out.

Two flaws in the Maestro flow itself were fixed at the same time, both of which had made it
assert less than it appeared to:

- Its selectors were unscoped, so `canonical-link-preview-card-0` matched the *topmost*
  such card in the channel — the oldest message's, not this run's. It now anchors every
  selector to the message carrying this run's `MAESTRO_RUN_ID`. The two platforms need
  different anchors for the same message: Android exposes the message text as a node of its
  own above the cards (`below`), while iOS exposes it only as the bubble's accessibility
  label and the bubble's bounds contain the cards (`childOf`).
- Its "the task opened" assertion was on the task title, which the card back in the channel
  also carries — it passed without anything having navigated. Both open-assertions now wait
  on a control unique to the destination screen (`task-copy-canonical-link`,
  `doc-share-button`) before asserting the title.

The flow also gained the document-card open, so the fix above has a runnable check behind
it, and `MAESTRO_LINK_PREVIEW_DOCUMENT_TITLE` to go with it — added to the
`check-maestro-link-preview-env` gate and, along with the other four feature-046 variables
that were never documented, to `.maestro/.env.example`.

[ASSUMPTION: the two platforms return to the channel differently — Android uses `back`,
iOS taps the chat tab and then re-enters the channel from the list. On iOS the task opens
inside the My Work tab with no back affordance, and merely returning to the chat tab
refocuses the composer, whose keyboard covers the second card with no dismissal left that
works there (`hideKeyboard` errors, a swipe from a bubble reaches the lock screen, and the
list will not scroll past the keyboard). Re-entering the channel is the only state that is
reliably keyboard-free. This is flow mechanics, not a product difference.]

### What was originally attempted (superseded by the above)


The flow file, the `check-maestro-link-preview-env` gate and the `.maestro/.env` fixtures
(a seeded task and document plus their canonical URLs) are all in place, and
`make test-mobile-one F=chat-link-previews` is the command. Two runs were attempted against
the connected Android emulator:

1. The first reached the shared `auth/signin.yaml` subflow and failed at
   `Assert that "Chat" is visible` — before any step of this feature's flow ran.
2. The second hung at `Launch app with clear state and clear keychain` and produced no
   step output; it was stopped.

The same harness ran the existing `chat-task-capture.yaml` to completion on that emulator
in between, so the device and the shared sign-in do work; the emulator appears to wedge
after repeated clear-state launches. **The new flow has therefore not been observed
passing, and the 360 dp by-eye check on Android and iOS has not been done.** Both need a
human at a device.

A pre-existing Makefile bug was fixed to get this far: `MAESTRO_ENV_FLAGS` did not quote
values, so `MAESTRO_SEARCH_DOCUMENT_TITLE=Zarquon Closing Procedure` split into two
arguments and Maestro read "Closing" as a flow path. Every `make test-mobile-one` run was
broken by it. `run-maestro-suite.sh` builds the same flags as a shell array and never had
the problem.

## Verification re-run (independent, after the notes above were written)

Everything above was re-checked rather than taken on trust. Results:

| Check | Result |
|---|---|
| `make test-backend-one T=TestChatLinkPreviews` | **PASS** |
| `make test-backend` (whole suite) | **PASS** — exit 0, 85s |
| `make lint-tenancy` | **PASS** — 552 queries, only the two pre-existing invitation deferrals |
| `pnpm --filter web exec tsc --noEmit` | **PASS** |
| `make test-frontend-one F=chat-link-previews` | **PASS** — 11/11 |
| `make test-frontend-one F=canonical-resource-links` | **PASS** — 6/6, including the one the earlier notes recorded as a full-suite flake |
| `pnpm typecheck:mobile` | 3 errors, each confirmed byte-identical at `HEAD` |
| Maestro `chat-link-previews.yaml` on Android emulator | **PASS** |
| Maestro `chat-link-previews.yaml` on iPhone SE (3rd gen) simulator | **PASS** |

Three things the earlier notes got wrong or left undone were fixed in this pass.

### `make test-frontend-one` was still broken

The earlier notes recorded the bad `--config=apps/web/e2e/playwright.config.ts` path as
"out of scope". It is one token, and it is the command T060/T061 name, so it was fixed:
`pnpm --filter web exec` already runs inside `apps/web`, so the config path is
`e2e/playwright.config.ts`. Both feature specs were then run through the make target.

### eslint did not pass on every changed frontend file

The earlier notes claim it did. It did not — `pnpm exec eslint` on the changed files
reported five `no-explicit-any` errors. Four are byte-identical at `HEAD`; **one was
introduced by this feature**, in the mobile document viewer T-036-equivalent change.
Chasing it found a real defect (below). The file is now down to the single pre-existing
`router.push(route as any)`, which is the Expo typed-routes cast and is left alone.

### The mobile document viewer never rendered its body — and so never previewed its links

`app/(app)/(more)/docs/[slug].tsx` read `doc.content` behind a `const d = doc as any`.
The field does not exist: `protoDocumentToNative` in `packages/apis/src/docs.ts` builds a
`Document` whose content field is **`contentJson`**. So `documentContentToText(d?.content)`
was called with `undefined` on every render and returned `""` — the document body has
always displayed blank, and this feature's new `documentTexts` memo inherited the same
wrong field, which meant the document screen's preview lookup was scanning an empty string
and could never produce a card.

The `as any` is what hid it, so the fix removes the cast rather than renaming the field
under it: both call sites now read `doc?.contentJson`, typechecked. Dropping the cast also
surfaced `d?.updatedByName`, another field `protoDocumentToNative` never sets — the
"last updated … by X" suffix has never rendered — so that dead clause was deleted.

`pnpm typecheck:mobile` is the runnable check behind this: with the cast gone, reading
`doc.content` again is a compile error. Confirmed on the wire too — the Maestro
`link-previews-03-document-open` screenshot now shows the document's body text where it
was previously an empty page under the title.

### iOS was not reachable through the repository's own command

The earlier notes ran iOS by hand-typing `--device <udid>` around the Makefile. The
Makefile now takes `MAESTRO_DEVICE`, so both platforms go through one command:

    make test-mobile-one F=chat-link-previews
    make test-mobile-one F=chat-link-previews MAESTRO_DEVICE=<simulator-udid>

[ASSUMPTION: `MAESTRO_DEVICE` defaults to empty, which preserves today's behaviour of
letting Maestro pick the device it finds. Naming a device is opt-in, not required.]

### Still outstanding

The three unrelated full-suite web failures the earlier notes list
(`legal-surface.spec.ts:59`, `ritual-submission-flow.spec.ts:355`,
`user-guide-screenshots.spec.ts:626`) were not re-investigated. They are in surfaces this
feature does not touch and are worth a separate look against `main`.
