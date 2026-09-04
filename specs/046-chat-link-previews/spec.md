# Feature Specification: Link Previews In Chat

**Feature Branch**: `046-chat-link-previews`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Link previews in chat. Render the existing canonical-link preview endpoint as a card when a message contains a task, document or event link. The endpoint exists and nothing renders it; a pasted task link is the most common way work crosses from chat to tasks and it is bare text."

## Context Correction

The premise is half right, and the half that is wrong changes what this feature has to build.

Both chat clients **already render a preview card** when a message contains a canonical
resource link. Web renders one in the message body; mobile renders one in the message
body. Both call the preview endpoint, both hide the card when the endpoint declines, and
both fall back to the raw clickable link. That work shipped with feature 030.

What is missing is the **content of the card**. The preview endpoint composes its metadata
from the URL alone — it never reads the resource. A pasted task link renders a card that
says `Task 0199c4f2-8ab1-7c33-9e20-5f2b1a44d901` with the subtitle `Task`. A document link
renders `Document <uuid>`. An event link renders `Event <uuid>`. The card is a
differently-shaped restatement of the URL, so the reader still cannot tell what was
linked without opening it. The user's underlying complaint — a pasted task link is bare
text that carries no meaning — is accurate; the cause is the empty metadata, not a missing
renderer.

Two further gaps compound it: only the **first** link in a message previews (a message
pasting three task links shows one card), and each message fetches its own preview on
mount with no reuse, so scrolling a busy channel issues one request per message.

This specification therefore covers: filling the preview with real, permission-scoped
resource data; previewing every supported link in a message rather than only the first;
and making the cost of previewing a channel proportional to distinct links rather than to
messages. It does **not** re-specify the card renderers, which exist and work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognize The Linked Work Without Opening It (Priority: P1)

As someone reading a chat channel, when a colleague pastes a link to a task, document or
event, I see what that resource actually is — its title and its current state — so I can
decide whether it concerns me without leaving the conversation.

**Why this priority**: This is the entire value of the feature. Everything else in this
spec is a refinement of a card that, until this story ships, tells the reader nothing they
could not read off the URL. A card showing an identifier is arguably worse than the raw
link, because it occupies more vertical space to convey the same nothing.

**Independent Test**: Paste a canonical task link into a channel and confirm the resulting
card names the task, its identifier, its current state and its assignee, matching what the
task detail screen shows for the same task at the same moment. Repeat for a document link
and an event link.

**Acceptance Scenarios**:

1. **Given** a task exists with a title, a human-readable identifier, a workflow state and
   an assignee, **When** someone pastes that task's canonical link into a channel the
   reader can see, **Then** the reader's preview card shows the task title, the
   identifier, the state and the assignee, and no raw resource identifier is displayed.
2. **Given** a document page exists with a title inside a named space, **When** its
   canonical link is pasted into a channel, **Then** the preview card shows the document
   title and the space it lives in.
3. **Given** a calendar event exists with a title and a scheduled start, **When** its
   canonical link is pasted into a channel, **Then** the preview card shows the event
   title and when it takes place.
4. **Given** a task's state changes after the message was posted, **When** the reader
   opens the channel afterwards, **Then** the card reflects the task's current state, not
   the state at the time the message was sent.
5. **Given** a reader has no access to the linked resource, **When** they read the message,
   **Then** they see the raw clickable link and no card, and no part of the resource's
   title, state or membership is disclosed to them.
6. **Given** the linked resource has been deleted, **When** a reader opens the message,
   **Then** they see the raw clickable link and no card.

---

### User Story 2 - See Every Resource A Message Links (Priority: P2)

As someone who pastes several related links into one message — a task, the document that
specifies it, and the review meeting — I want each of them previewed, so the message
communicates the whole set rather than only whichever link happened to come first.

**Why this priority**: Multi-link messages are the handoff pattern this feature exists to
serve, but a single correct card already delivers most of the value, so this refines
Story 1 rather than blocking it.

**Independent Test**: Post one message containing a task link, a document link and an
event link, and confirm three distinct cards render in the order the links appear in the
message text.

**Acceptance Scenarios**:

1. **Given** a message contains three distinct supported canonical links, **When** it
   renders, **Then** three preview cards appear in the order the links appear in the text.
2. **Given** a message contains more supported links than the display cap, **When** it
   renders, **Then** the first cards up to the cap render and the remaining links stay
   visible as raw clickable text.
3. **Given** a message contains the same canonical link twice, **When** it renders,
   **Then** one card renders for that resource, not two.
4. **Given** a message contains one supported link the reader can access and one they
   cannot, **When** it renders, **Then** the accessible resource gets a card and the
   inaccessible one remains a raw clickable link.

---

### User Story 3 - Read A Busy Channel Without Waiting On Previews (Priority: P3)

As someone scrolling a channel where links are pasted constantly, I want the conversation
to render and stay responsive regardless of how many links are in view, and I want a
resource that appears in twenty messages to be looked up once.

**Why this priority**: A correctness-neutral efficiency and responsiveness concern. It
matters at real channel volumes but does not change what any single card says.

**Independent Test**: Open a channel whose visible page contains fifty messages carrying
links to a handful of distinct resources, and confirm the message list renders
immediately, cards fill in progressively, and the number of preview lookups is
proportional to the number of distinct resources rather than to the number of messages.

**Acceptance Scenarios**:

1. **Given** a page of messages linking to a small number of distinct resources, **When**
   the reader opens the channel, **Then** the number of preview lookups performed is at
   most the number of distinct linked resources in view.
2. **Given** previews have not yet resolved, **When** the channel renders, **Then**
   messages and their text are readable immediately and cards appear as they resolve,
   without the message list shifting content the reader is actively reading.
3. **Given** a preview lookup fails or times out, **When** the message renders, **Then**
   the raw clickable link is shown, no error is surfaced to the reader, and the failure
   does not block any other message from rendering.
4. **Given** the same resource is linked from several messages in view, **When** the
   channel renders, **Then** every one of those messages shows a card and the resource
   was looked up once.

### Edge Cases

- A message contains a link to a resource in a different organization than the reader's:
  no card, raw link preserved, nothing about the resource disclosed.
- A message links a task that has already been surfaced on that same message as a
  conversion chip from the chat-to-task quick action: the message must not show the same
  task twice; the chip is the authoritative representation and the duplicate card is
  suppressed.
- A message links a resource whose title is very long or contains markup characters: the
  card truncates to a bounded number of lines and renders the title as text, never as
  markup.
- A message links a resource whose title is empty: the card falls back to the resource's
  human-readable identifier rather than to an internal identifier.
- A message links a chat channel or thread inside the same channel being read: previewing
  must not recurse into rendering that channel's messages.
- A link is edited out of a message: the card disappears on the next render of that
  message.
- A link points at a supported resource type the reader's client build does not know how
  to open: the card still renders and tapping it falls back to the resource's web
  destination.
- A message posted before this feature shipped: it previews on read like any other, since
  previews are computed at read time and nothing is stored on the message.
- Network is unavailable on mobile: raw links stay clickable, no cards, no error banner.

## Requirements *(mandatory)*

### Functional Requirements

#### Preview content

- **FR-001**: The link preview for a task instance MUST carry the task's title, its
  human-readable identifier, its current workflow state and its current assignee, read
  from the task at the time of the request.
- **FR-002**: The link preview for a document page MUST carry the document's title and the
  name of the space or parent it belongs to.
- **FR-003**: The link preview for a calendar event MUST carry the event's title and its
  scheduled start, expressed so a client can render it in the reader's local time.
- **FR-004**: The link preview for a project destination MUST carry the project's name.
- **FR-005**: The link preview for a chat channel MUST carry the channel's name; for a
  chat thread it MUST carry the thread's parent channel name and an indication that the
  target is a thread.
- **FR-006**: A preview MUST NOT display a raw internal resource identifier as its title
  or subtitle. When a resource's own title is absent, the preview MUST fall back to that
  resource's human-readable identifier, and when no such identifier exists it MUST fall
  back to the resource type name alone.
- **FR-007**: Preview content MUST reflect the resource's state at the time of the request,
  not at the time the message was posted, and MUST NOT be stored on the message.
- **FR-008**: A preview MUST carry a resource type indication sufficient for a client to
  choose an icon or badge without parsing the title.

#### Access and disclosure

- **FR-009**: The system MUST only return preview content for a resource the requesting
  person is entitled to see, evaluated per request against that person's identity and
  organization.
- **FR-010**: When the requester is not entitled to the resource, is unauthenticated, or
  the resource does not exist, the system MUST return no preview content and MUST NOT
  distinguish these cases in a way that reveals whether the resource exists.
- **FR-011**: Two readers of the same message MAY see different preview outcomes according
  to their own access, and neither reader's outcome may be inferred from the message
  content itself.
- **FR-012**: Preview requests MUST be scoped to the requester's organization; a link
  bearing another organization's tenant key MUST NOT return preview content.

#### Rendering

- **FR-013**: Both the web and mobile chat clients MUST render a preview card for every
  supported canonical link in a message for which preview content is available, up to a
  fixed display cap, in the order the links appear in the message text.
- **FR-014**: Repeated occurrences of the same canonical resource within one message MUST
  produce at most one card.
- **FR-015**: When preview content is unavailable for a link, for any reason, the client
  MUST leave that link visible as clickable text and MUST NOT render a card, a skeleton
  that never resolves, or an error message.
- **FR-016**: A link that produced a card MUST NOT also appear as duplicated raw link text
  in the message body; links that did not produce a card MUST remain in the body.
- **FR-017**: Activating a preview card MUST navigate to the linked resource inside the
  app when the client can route to it, and MUST fall back to opening the resource's web
  destination otherwise.
- **FR-018**: When a message already displays a task via the chat-to-task conversion chip,
  a preview card for that same task MUST be suppressed on that message.
- **FR-019**: Preview cards MUST render resource-supplied text as plain text and MUST NOT
  interpret it as markup.

#### Cost and responsiveness

- **FR-020**: The clients MUST be able to obtain previews for several links in one
  request so that rendering a page of messages does not require one request per message.
- **FR-021**: Preview results MUST be reused within a client session for the same link and
  reader, so that a resource linked from many visible messages is looked up once.
- **FR-022**: Message text MUST render without waiting on preview resolution; cards appear
  when they resolve.
- **FR-023**: A failed or slow preview lookup MUST NOT prevent any other message or any
  other link in the same message from rendering.
- **FR-024**: The system MUST bound the number of links it will resolve in a single
  preview request and MUST reject or truncate beyond that bound rather than performing
  unbounded work.

### Key Entities

- **Canonical resource link**: a product-owned HTTPS link identifying one shareable
  resource — a task instance, document page, calendar event, project destination, chat
  channel, chat thread or booking item — together with the tenant it belongs to and
  optional focus context. Already defined and generated by the existing linking contract.
- **Link preview**: the reader-specific, request-time description of the resource a
  canonical link points at — a title, a supporting line, a type indication and a
  destination. Derived, never stored, and valid only for the person who requested it.
- **Chat message**: the carrier. Its stored text is unchanged by this feature; previews
  are computed when the message is read.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every supported resource type, a reader who can access the linked
  resource can state the resource's title and, for tasks, its current state, from the chat
  message alone, without opening the link.
- **SC-002**: No preview card displays an internal resource identifier as its title or
  subtitle in any supported resource type.
- **SC-003**: A message containing several supported links shows a card for each of them,
  up to the display cap, on both web and mobile.
- **SC-004**: A reader without access to a linked resource learns nothing about it from
  the message beyond the fact that a link was pasted, verified for each supported resource
  type.
- **SC-005**: Opening a channel page containing 50 messages that link to 5 distinct
  resources performs at most 5 preview lookups.
- **SC-006**: The chat message list becomes readable and scrollable within the same time
  as before this feature, whether or not any preview has resolved.
- **SC-007**: Preview content shown for a task matches the task detail view for the same
  task at the same moment, for title, identifier, state and assignee.
- **SC-008**: Every preview outcome — resolved, unauthorized, not found, failed — leaves
  the message readable and the link openable.

## Assumptions

- [ASSUMPTION: Unfurling arbitrary external URLs — fetching third-party pages for their
  social metadata — is out of scope. The user's description names task, document and event
  links, all product-owned; external unfurling introduces outbound fetching, server-side
  request forgery exposure, and a caching and abuse surface that nothing in the request
  asks for.]
- [ASSUMPTION: The display cap for preview cards on one message is 3, matching the
  existing cap on chat-to-task conversion chips, so a message cannot push the conversation
  off screen. Links beyond the cap stay as raw clickable text.]
- [ASSUMPTION: Preview cards do not show thumbnails or avatar images in this feature. The
  preview contract already carries a thumbnail slot that nothing populates; filling it
  raises image hosting and access-control questions disproportionate to the value of
  naming the resource.]
- [ASSUMPTION: Previews are computed at read time on every render rather than captured
  onto the message at post time. This keeps a stale state out of the transcript, keeps
  access evaluation per reader, and means messages posted before this feature preview
  normally.]
- [ASSUMPTION: Preview reuse within a session is a client-side concern keyed by link and
  reader, held for the life of the session. No shared server-side cache is introduced,
  because a cache keyed by reader entitlement is a correctness hazard disproportionate to
  the load this endpoint sees.]
- [ASSUMPTION: The batching requirement (FR-020) replaces the current single-link request
  shape outright rather than adding a second endpoint beside it. The project carries no
  backward-compatibility obligation and both clients ship together.]
- [ASSUMPTION: Booking item links keep their current generic preview. Bookings are
  external-facing scheduling targets with no per-reader resource record to read, so there
  is no richer content to fetch.]
- [ASSUMPTION: Composer-time previews — showing the card while typing, before sending —
  are out of scope. The request is about reading messages.]
- The canonical link contract from feature 030 is stable and continues to own link
  generation, normalization and access resolution; this feature adds content to previews
  and does not change what a canonical link means.
- Both chat clients already render preview cards and fall back to raw links; those
  renderers are extended, not replaced.
