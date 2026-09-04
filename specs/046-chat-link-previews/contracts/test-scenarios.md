# Behavioural Contract: Link Previews In Chat

Constitution principle II makes these scenarios planning artifacts first and test files
second. They are the contract for feature 046 and are **approved as part of this plan**,
before `/speckit-tasks` runs and before any code is written.

- Backend: `backend/integration/chat_link_previews_test.go` — `testWorld` pattern, the
  batch endpoint called over HTTP with a dev JWT, nested `t.Run`, `// FR-XXX` comments.
- Web E2E: `frontend/apps/web/e2e/chat-link-previews.spec.ts` — Playwright, mirroring the
  backend names.
- Mobile: `frontend/apps/mobile/.maestro/chat-link-previews.yaml` — one happy-path flow.

Two existing suites assert the behaviour this feature deletes and are **changed, not
added to**:

| File | Existing assertion | Becomes |
|---|---|---|
| `backend/integration/canonical_links_test.go` | `require.Contains(t, preview.Preview.Title, task.Id)` | the title is the task's **title** and contains no UUID; helper moves to the batch endpoint |
| `frontend/apps/web/e2e/canonical-resource-links.spec.ts` | `expect(previewCard).toContainText(taskId)` | the card contains the task title and identifier, and **not** the UUID |

---

## Fixture

One world, built once. Titles use `gasket` so nothing seeded collides.

| # | Thing | Detail |
|---|---|---|
| 1 | employee `owner` | owner role |
| 2 | employee `member` | employee role; member of the public project, the public channel, no private project |
| 3 | employee `outsider` | employee role; member of nothing |
| 4 | employee `assignee` | employee role, named `Mai Anh Nguyen` |
| 5 | project `Operations` | `key = OPS`, public |
| 6 | project `Board` | private, owner-only |
| 7 | task `Replace the walk-in gasket` | in `Operations`, state `In progress`, assigned to `assignee` |
| 8 | task `Second gasket task` | in `Operations`, two assignees |
| 9 | task `Confidential gasket audit` | in `Board` (private) |
| 10 | task `Deleted gasket task` | in `Operations`, soft-deleted after its link is generated |
| 11 | task `Untitled` case | a task whose title is set to an empty string directly in the fixture |
| 12 | document `Gasket Handbook` | public, root |
| 13 | document `Gasket Procedure` | child of `Gasket Handbook`, public |
| 14 | document `Gasket Denied Notice` | public **plus** an explicit `access_level = 'none'` employee grant to `member` |
| 15 | event `Gasket stocktake` | `visibility = 'org_wide'`, known `start_time` |
| 16 | event `Gasket private review` | `visibility = 'private'`, organised by `owner`, no attendees |
| 17 | event `Gasket cancelled offsite` | `org_wide`, `cancelled_at` set |
| 18 | channel `#gasket-ops` | public |
| 19 | channel `#gasket-secret` | private, `owner` only |
| 20 | thread root message in `#gasket-ops` | for the thread link |
| 21 | a second organization with its own task | for the cross-tenant case |

---

## Backend integration scenarios

```
TestChatLinkPreviews

  when a task link is previewed by someone who can see the task            [US1]
    it returns the task title, not an identifier                            FR-001 FR-006 SC-002
    it returns the human-readable identifier, the state and the assignee    FR-001 SC-007
    it returns a resource type indication a client can badge                FR-008
    it names the second assignee count rather than listing everyone         FR-001
    it reflects the task's current state after the state changes            FR-007
    it falls back to the identifier when the task has no title              FR-006

  when a document link is previewed                                        [US1]
    it returns the document title and the parent it lives under             FR-002
    it names the workspace when the document is a root document            FR-002

  when a calendar event link is previewed                                  [US1]
    it returns the event title and an instant the client can localise       FR-003
    it marks an all-day event so no wall-clock time is implied              FR-003
    it returns nothing for a cancelled event                                FR-003 FR-010

  when a project, channel or thread link is previewed                      [US1]
    it returns the project name for a project link                          FR-004
    it returns the channel name for a channel link                          FR-005
    it returns the parent channel name and a thread indication for a thread FR-005
    it returns nothing drawn from the thread's messages                     FR-005

  when the reader is not entitled to the linked resource                   [US1]
    a task in a private project the reader is not in returns nothing        FR-009 SC-004
    a document with an explicit deny grant returns nothing                  FR-009
    a private event the reader neither organises nor attends returns nothing FR-009
    a private channel the reader is not in returns nothing                  FR-009
    a deleted task returns nothing                                          FR-010
    a resource that never existed returns nothing                           FR-010
    the denied and the missing cases are byte-identical responses           FR-010 SC-004
    an unauthenticated request returns nothing for every url                FR-010
    a link bearing another organization's tenant key returns nothing        FR-012

  when two readers request the same link                                   [US1]
    each sees the outcome their own access allows                           FR-011

  when one request carries several links                                   [US2]
    every accessible link is resolved in one request                        FR-020 SC-005
    the items come back in request order, echoing each url                  FR-013
    an accessible and an inaccessible link are answered independently       FR-013 SC-008
    a malformed url is unavailable and does not fail the batch              FR-023
    a link to an unsupported resource type is unavailable                   FR-023
    more urls than the request bound is rejected outright                   FR-024
    the same url twice is looked up once and answered twice                 FR-014

  when the resource type is booking                                        [US1]
    it keeps its generic card without reading a row                         FR-008
```

Cost assertion behind SC-005, asserted in the backend suite rather than the UI: a request
carrying 20 links spanning 5 distinct resources of 3 types issues **one** HTTP request and
resolves in **three** provider calls. Provider call counts are observed through the
`slog` line the aggregator writes, not through a test-only hook.

---

## Web E2E scenarios (`chat-link-previews.spec.ts`)

Arrange via API, act via the browser, assert what the reader sees.

```
Chat link previews

  when a message links a task the reader can see                           [US1]
    the card names the task and its state, and shows no uuid                FR-001 SC-001 SC-002
    activating the card opens the task in the app                          FR-017
    the card renders a title containing markup characters as plain text    FR-019

  when a message links three supported resources                           [US2]
    three cards appear in the order the links appear in the text           FR-013 SC-003
    each linked url is removed from the message body                       FR-016
    the same link twice produces one card                                  FR-014

  when a message links more resources than the display cap                 [US2]
    the first three preview and the rest stay clickable text               FR-013 FR-016

  when a message links one resource the reader may see and one they may not [US2]
    only the accessible resource gets a card                                FR-013
    the inaccessible link stays visible as clickable text                   FR-015 FR-016

  when the reader cannot see the linked resource at all                    [US1]
    no card renders and no error is shown                                   FR-015 SC-004
    the raw link stays clickable                                            FR-015 SC-008

  when a message already shows a task conversion chip                      [US2]
    a preview card for that same task is suppressed                         FR-018

  when a busy channel is opened                                            [US3]
    the messages are readable before any card resolves                      FR-022 SC-006
    cards fill in without moving the message the reader is on               FR-022
    fifty messages linking five resources issue one preview request         FR-020 FR-021 SC-005
    every message linking the same resource shows a card                    FR-021

  when a link is edited out of a message                                   [edge]
    the card disappears on the next render                                  FR-007
```

The request-count assertion uses `page.route`/`waitForRequest` counting on
`**/api/linking/previews`, which is why the endpoint is a single URL rather than a family.

---

## Mobile Maestro flow (`chat-link-previews.yaml`)

Happy path only, per Principle XIII: sign in, open a channel seeded with a message
carrying a task link and a document link, assert both `canonical-link-preview-card`
testIDs are visible and that the first one shows the task title and identifier, tap it,
assert the task screen opens. Verified at 360 dp on Android as well as iOS.

---

## Documented exclusions

| Not covered | Why |
|---|---|
| Booking preview content | unchanged by this feature; no per-reader row exists to read |
| `message` and `workspace` link types | they describe no resource of their own; they were never previewable and stay that way |
| Composer-time previews | out of scope per the spec's assumptions |
| External URL unfurling | out of scope per the spec's assumptions |
| Offline mobile behaviour ("no cards, no banner") | asserted in the backend/E2E failure paths; Maestro has no offline harness in this repository |
| The per-message cap on mobile | web E2E covers the cap; the cap constant is shared, so a second platform assertion tests the same line twice |
