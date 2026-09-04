# Quickstart: Link Previews In Chat

How to build, run and validate feature 046. The endpoint and interface shapes are in
[contracts/link-preview-api.md](contracts/link-preview-api.md), the SQL in
[contracts/preview.query.sql](contracts/preview.query.sql), the access rules in
[data-model.md](data-model.md) and the behavioural contract in
[contracts/test-scenarios.md](contracts/test-scenarios.md) — none of it is repeated here.

---

## Prerequisites

Everything runs through the repository's own tooling. Do not improvise a local setup.

```bash
make infra-up          # PostgreSQL and friends
make check-servers     # confirms postgres, backend and frontend are reachable
```

---

## Regenerating after a query change

One generator. There is **no migration and no schema change** in this feature, so
`regen-schema.sh` is not part of the loop.

```bash
cd backend && sqlc generate     # the six new queries -> typed Go
```

Changing `PreviewProvider`'s signature breaks every provider at compile time, which is the
point: the compiler enumerates the seven call sites that must stop composing a card from a
URL.

---

## Validating the feature

### 1. Backend behaviour — the contract suite

```bash
make test-backend-one T=TestChatLinkPreviews    # this feature alone, while iterating
make test-backend                               # the ENTIRE suite — required for DONE
make lint-tenancy                               # four schemas' query files change
```

`TestCanonicalLinks` asserts today that a preview title *contains the task UUID*. That
assertion is the bug, and it fails after this change. Correct it — do not silence it.

A one-shot check of the endpoint by hand:

```bash
curl -s -H "Authorization: Bearer $DEV_JWT" -H 'Content-Type: application/json' \
  -d '{"urls":["https://localhost:3000/o/acme/r/task/<taskId>","https://localhost:3000/o/acme/r/document/<docId>"]}' \
  http://localhost:18080/api/linking/previews | jq
```

Expect two items, in request order, each echoing its URL. Repeat with no `Authorization`
header: still `200`, both items `unavailable`, no `preview` key. Repeat with the token of
someone outside the task's project: the task item is `unavailable` and its bytes are
identical to the response for a task id that never existed.

### 2. Web behaviour

```bash
make test-frontend-one F=chat-link-previews
make test-frontend                              # the ENTIRE suite — required for DONE
```

Then look at it. Post one message into a channel containing a task link, a document link
and an event link, and confirm:

- three cards, in the order the links appear, each naming the resource — no UUID anywhere;
- the task card shows the identifier, the state and the assignee, and they match the task
  detail screen open in another tab (SC-007);
- the three URLs are gone from the message body, and a fourth link past the cap of three is
  still there as clickable text;
- change the task's state in the other tab and reload the channel: the card follows;
- sign in as someone without access to the project and read the same message: no card, the
  raw link still clickable, nothing on screen naming the task.

Watch the network panel while scrolling a busy channel: **one** request to
`/api/linking/previews` per rendered page, not one per message, and no second request for a
resource already seen this session.

### 3. Mobile behaviour

```bash
make test-mobile-one F=chat-link-previews
make test-mobile                                # the ENTIRE suite — required for DONE
```

Maestro cannot assert layout, so verify by eye on **both** platforms — the habitual test
device is an iPhone SE and narrow-Android regressions otherwise go unnoticed:

- 360 dp Android and iOS: three stacked cards in one message do not clip, and a long
  resource title truncates rather than pushing the card wide;
- a link the reader cannot open shows **no card at all** — this is the regression to watch
  for, because mobile currently fabricates a `Task <uuid>` card in exactly that case;
- tapping a card opens the resource in the app; tapping a task card that also has a
  conversion chip is impossible, because that card is suppressed (FR-018);
- with the network off, messages still read and links stay tappable, with no error banner.

---

## Manual checks the automated suites deliberately do not cover

### The disclosure check (SC-004)

For each of task, document, event, channel and thread, capture the response body for
(a) a reader without access and (b) a resource id that does not exist. Diff them. They must
be byte-identical. This is the one property that a behavioural test can pass while the
implementation is subtly wrong — a length difference, an ordering difference or a stray
field is a disclosure oracle.

### Cost (SC-005)

Seed a channel with 50 messages linking 5 distinct resources, open it, and count requests
to `/api/linking/previews` in the network panel: expect 1, carrying 5 URLs. Then check the
server `slog` line for that request: expect one provider call per distinct resource *type*,
not per link.

### Interaction with known drift D53

`internal/linking` emits `/workspace/calendar/{eventId}` as an event's canonical web route
and no such page exists on web. An event preview card is therefore correct in what it says
and wrong in where it lands on web until D53 is fixed. Confirm the card falls back to
`/workspace/calendar` rather than a 404 (FR-017's "fall back to the resource's web
destination"), and leave D53 open — fixing it is a calendar change, not this feature.

---

## Definition of Done for this feature

- [ ] `make test-backend` passes end to end
- [ ] `make test-frontend` passes end to end
- [ ] `make test-mobile` passes end to end
- [ ] `make lint-tenancy` passes
- [ ] no `t.Skip("TODO")` or `test.skip` remains from this feature's scenarios
- [ ] `TestCanonicalLinks` and `canonical-resource-links.spec.ts` updated to assert a card
      that names the resource rather than one that repeats its UUID
- [ ] no caller of the deleted `GET /api/linking/preview` remains anywhere in the repository
- [ ] `describeCanonicalResourceLink` and every URL-derived preview fallback are gone
- [ ] mobile verified by eye at 360 dp on **Android and iOS**
- [ ] `docs/domain/workspace-navigation.md`: endpoint table, resolution order and provider
      ownership rewritten; the single-URL preview endpoint **deleted** from the document,
      not annotated
- [ ] `docs/domain/chat.md`: what a message renders for a canonical link now that a message
      can carry several cards
- [ ] `docs/domain/docs-knowledge.md` and `docs/domain/calendar.md`: previews are
      access-scoped, replacing the existence-only check that was there
- [ ] drift register in `docs/domain/README.md` reviewed: D53 stays open and is referenced
      by the event card's fallback behaviour
