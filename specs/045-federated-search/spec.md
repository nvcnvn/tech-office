# Feature Specification: Server-Side Federated Search

**Feature Branch**: `045-federated-search`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Server-side federated search. Wire documents, files, tasks and calendar events into the search box on both platforms, each source enforcing its own access rules. Searching a document title from the search box returns nothing today, while messy search history is a stated reason to leave WhatsApp. Clears drift D5."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find The Thing By Typing Its Name (Priority: P1)

Somebody remembers a thing exists and remembers roughly what it is called — the closing
procedure, last month's invoice PDF, the "restock freezer" task, next Tuesday's stocktake.
They open the search box, type the name, and the thing is in the list with a badge saying
what kind of thing it is. One box, one list, whatever kind of thing it is.

**Why this priority**: This is the entire feature, and today it silently fails. The search
box already exists on both platforms and already looks like it searches the workspace, but
it only ever asks four questions — people, departments, channels, messages. Typing the
exact title of a document that plainly exists returns "no results", which is worse than a
missing feature: it teaches people the thing is gone. Everything else in this spec either
makes this story correct or stops it leaking something.

**Independent Test**: In a workspace that has a document, an uploaded file, a task and a
calendar event whose titles share a distinctive word, sign in on web and on mobile, type
that word into the search box, and confirm all four appear alongside the people, channels
and messages that also match.

**Acceptance Scenarios**:

1. **Given** a document titled "Closing Procedure" that the signed-in person may read,
   **When** they type "closing procedure" into the search box, **Then** a Document row for
   it appears in the results.
2. **Given** a task titled "Restock the freezer" in a project the person can see, **When**
   they search "restock", **Then** a Task row for it appears, naming its project.
3. **Given** a calendar event titled "Quarterly stocktake" the person may see, **When**
   they search "stocktake", **Then** an Event row for it appears with its date.
4. **Given** an uploaded file named "invoice-august.pdf", **When** they search "invoice",
   **Then** a File row for it appears, naming where it was uploaded.
5. **Given** the same query typed on web and on mobile by the same person, **When** the
   results come back, **Then** both platforms show the same set of results in the same
   order.

---

### User Story 2 - Nothing In The List Is A Door I Cannot Open (Priority: P1)

Every row in the results is something the person is allowed to see. A private document
somebody else wrote, a file in a channel they are not in, work in a private project they
are not a member of, and a colleague's private calendar event are all absent — not shown
and refused on tap, absent.

**Why this priority**: A search box is a disclosure surface. It reports titles, snippets,
project names and dates for anything it returns, so an over-broad result set leaks the
existence and the wording of work the person has no business knowing about — and it does
so at scale, one query at a time, with no audit trail that reads as unusual. Two of the
four new sources are over-broad today: document search returns every document in the
organization to anyone holding the view permission, and event search ignores event
visibility entirely. Wiring those into a prominent search box without fixing them turns a
latent problem into a daily one. This ships with story 1 or not at all.

**Independent Test**: Create a private document, a private-project task, a file in a
channel, and a private calendar event, all containing the same distinctive word. Sign in as
somebody with no access to any of them and search that word. Expect zero results. Sign in
as the owner of each and search again. Expect four.

**Acceptance Scenarios**:

1. **Given** a document the signed-in person has no access to, **When** they search a word
   from its title, **Then** no Document row for it appears and no snippet of its content
   is shown.
2. **Given** a task in a private project the person is not a member of, **When** they
   search a word from its title, **Then** no Task row for it appears.
3. **Given** a calendar event marked private that the person neither organises nor
   attends, **When** they search a word from its title, **Then** no Event row for it
   appears.
4. **Given** a file uploaded to a channel the person is not a member of, **When** they
   search its filename, **Then** no File row for it appears.
5. **Given** any result row the person can see, **When** they tap or click it, **Then** it
   opens — no result in the list may lead to a permission refusal.

---

### User Story 3 - The Search Box Does Not Half-Fail In Silence (Priority: P2)

When one kind of thing cannot be searched right now — a slow source, a source that errors —
the person still gets every other kind, and is told plainly that one kind is missing rather
than being shown a shorter list that looks complete.

**Why this priority**: The current client-side fan-out already survives a failing source,
but it does so by swallowing the error, so a broken document search and a workspace with no
documents look identical. Going from four sources to eight roughly doubles the chance that
some source is unhealthy on any given query, which makes "quietly shorter" a much more
likely answer than it is today. This is a correctness-of-reporting story, not a new
capability, so it is P2 — story 1 is still usable without it.

**Independent Test**: Make one source fail, run a search that would match in several
sources, and confirm the other sources' results are shown together with a visible note
naming the source that could not be reached.

**Acceptance Scenarios**:

1. **Given** one source is failing, **When** a person searches, **Then** results from every
   healthy source are shown and a message names the kind of result that is unavailable.
2. **Given** one source is slow past the search's time budget, **When** the results are
   rendered, **Then** the person is not left waiting on it — the healthy sources are shown
   and the slow one is reported as unavailable.
3. **Given** every source fails, **When** a person searches, **Then** they see an error
   rather than an empty-looking "no results".

---

### User Story 4 - Narrow To One Kind (Priority: P3)

Somebody who knows they are looking for a document, and gets a list mostly full of chat
messages, narrows the results to documents and sees more of them.

**Why this priority**: A single flat list is enough to find a thing when you know its name,
which is the case story 1 addresses. Filtering matters when a common word matches a hundred
messages and two documents. The web results page already has category tabs for the four
existing sources, so the new sources need tabs there for consistency; mobile can gain
narrowing later. Nothing else depends on this.

**Independent Test**: Search a word matching many results across kinds, narrow to one kind,
and confirm the list shows only that kind and shows more of it than the mixed list did.

**Acceptance Scenarios**:

1. **Given** results across several kinds, **When** the person narrows to Documents,
   **Then** only Document rows are shown and more of them are listed than in the mixed
   view.
2. **Given** the person has narrowed to a kind, **When** they change the query, **Then**
   the narrowing is kept.

---

### Edge Cases

- **A one-character query.** Search does not run below the existing minimum query length;
  the person sees their recent items, not an empty result set.
- **A query matching nothing anywhere.** One "no results" message for the whole search, not
  eight empty sections.
- **A query matching in every source.** The combined list stays bounded and readable; no
  single source may crowd the others out of the first screen.
- **A result whose target has been deleted between the search and the tap.** The person
  gets a plain "this no longer exists" rather than a blank screen or a crash.
- **A person whose role denies them a whole source** (no permission to view documents at
  all). That source contributes nothing and is not reported as an error — it is not
  broken, it is not theirs.
- **A ritual instance vs. a plain task.** Both are work items; searching a ritual's name
  finds the ritual's runs the same way it finds ordinary tasks, and the row says which it
  is.
- **A cancelled calendar event, an archived project's tasks, a deleted document, a file
  whose validation failed.** None of these appear.
- **Non-Latin and mixed-language queries.** A Vietnamese document title is found by typing
  it, in the same box, with the same behaviour as an English one.
- **A person searching from a phone with no connection.** The search box says the search
  could not run; it does not present a stale or empty list as the answer.

## Requirements *(mandatory)*

### Functional Requirements

**One search, answered by the server**

- **FR-001**: A single search request MUST return results from all eight sources — people,
  departments, channels, messages, documents, files, work items and calendar events — with
  the fan-out, access filtering, ranking and truncation performed on the server.
- **FR-002**: Web and mobile MUST obtain their results from that one request, so that the
  same person typing the same query on both platforms sees the same results in the same
  order.
- **FR-003**: Every result MUST carry enough to render and open it without a second
  lookup: what kind of thing it is, its title, a one-line context line naming where it
  lives, and the identifiers needed to navigate to it.
- **FR-004**: The response MUST state, per source, whether that source answered, returned
  nothing, was unavailable, or was skipped because the caller lacks the permission to
  search it. A client MUST be able to tell "no documents match" apart from "documents could
  not be searched".
- **FR-005**: A source that fails or exceeds the search's time budget MUST NOT fail the
  whole search. Results from every source that answered MUST still be returned.
- **FR-006**: The search MUST return within the stated time budget as experienced by the
  caller, regardless of how slow any one source is.

**What each source may return**

- **FR-007**: Document results MUST be restricted to documents the caller may read.
  Document titles and content snippets MUST NOT be returned for documents whose content the
  caller could not open, closing the widest part of drift D49.
- **FR-008**: Calendar event results MUST be restricted to events the caller organises,
  attends, or whose visibility makes them visible to the caller's team or the whole
  organization — the same rule the organization-wide event listing already applies.
  Cancelled events MUST NOT be returned.
- **FR-009**: Work item results MUST be restricted to items in projects the caller may
  read: any project marked public, plus private projects the caller is a member of. Items
  in projects the caller cannot read MUST NOT be returned, and their existence MUST NOT be
  disclosed by any count or message.
- **FR-010**: File results MUST continue to be restricted to files the caller may
  download, which the file source already enforces.
- **FR-011**: People, department, channel and message results MUST behave exactly as they
  do today; this feature MUST NOT change what those four return.
- **FR-012**: A caller lacking the permission to search a source MUST simply receive no
  results from it, reported as skipped rather than as an error, and MUST NOT be shown a
  permission failure for the search as a whole.

**Ranking and shape of the answer**

- **FR-013**: Results MUST be returned as one ranked list with each row labelled by kind,
  ordered by each source's own relevance ranking of its own hits, combined by a documented,
  deterministic rule so that the same query and the same data always produce the same
  order.
- **FR-014**: No single source may occupy the whole first page of results; the combined
  list MUST be capped per source so that a query matching a hundred messages still shows
  the one matching document above the fold.
- **FR-015**: The caller MUST be able to ask for results from one named kind only, and get
  a deeper list of that kind than the mixed list contains.
- **FR-016**: The number of results returned MUST be bounded whatever the query, so no
  query can return an unbounded page.

**On the screens**

- **FR-017**: The mobile search screen MUST render and open all eight kinds of row. Tapping
  a Document, File, Work item or Event row MUST navigate to that thing on mobile; no row
  kind may be rendered without somewhere to go.
- **FR-018**: The web search results page MUST show the four new kinds alongside the
  existing four, in both the combined list and as narrowing categories, with counts.
- **FR-019**: A row whose target cannot be opened on the current platform MUST say so
  rather than doing nothing when tapped.
- **FR-020**: Search entry points MUST stay where they are — the workspace search box on
  web, the search pill on the mobile tabs. This feature adds no new entry point.
- **FR-021**: Recent-search behaviour MUST keep working for the new kinds: a Document or
  Event opened from search MUST be offered again as a recent item on the next visit, and
  clearing recents MUST clear them.
- **FR-022**: A stored recent item whose target has since been deleted or become
  inaccessible MUST NOT open a broken screen; it MUST report that the item is gone and stop
  being offered.

**Documentation**

- **FR-023**: Drift register entry D5 MUST be removed and the federated-search section of
  the workspace-and-navigation snapshot MUST describe the server-side behaviour that
  actually ships, including the per-source access rules.
- **FR-024**: Drift register entry D49 MUST be updated to cover only what remains after
  this feature — the organization-scoped document tree listings — or removed if nothing
  remains.

### Key Entities

- **Search request**: what was typed, an optional single-kind narrowing, and how many
  results are wanted. Carries no identity of its own — who is asking comes from the
  session, and every access decision follows from it.
- **Search result**: one findable thing. Kind, title, a context line saying where it lives,
  a relevance position within its own kind, and the identifiers needed to open it on either
  platform.
- **Source outcome**: per source, whether it answered, how many it returned, and if it did
  not answer, why — unavailable or not permitted. This is what makes an incomplete answer
  legible instead of silently short.
- **Searchable kind**: the eight things a search can return — person, department, channel,
  message, document, file, work item, calendar event. This set is closed; adding to it is a
  change to this contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Typing the exact title of a document, a file, a work item or a calendar event
  into the search box returns that thing in the results, on web and on mobile, in 100% of
  cases where the person may see it.
- **SC-002**: In a permission matrix covering every source and both a permitted and a
  denied caller, zero results are returned that the caller could not open, and zero results
  are withheld that they could — no leaks and no false negatives.
- **SC-003**: Nothing in the results list refuses on open: across the matrix in SC-002,
  every returned row navigates successfully to its target.
- **SC-004**: A search over a workspace with a realistic volume of content returns in under
  1 second at the 95th percentile as experienced by the person typing, and never blocks
  past its time budget on a single slow source.
- **SC-005**: With any one source made to fail, a search still returns every other
  source's results and names the missing kind; with all sources failing, the person sees an
  error and not an empty list.
- **SC-006**: A query matching a hundred chat messages and one document shows that document
  without scrolling.
- **SC-007**: The same query run by the same person on web and on mobile produces the same
  ordered result set.
- **SC-008**: Searching a Vietnamese title in Vietnamese finds it, with the same success
  rate as the English equivalent.
- **SC-009**: Drift register entry D5 is closed, D49 is narrowed to the document tree
  listings alone, and no repository document still describes the search box as a
  client-side fan-out over four sources.
- **SC-010**: The mobile search screen renders and operates correctly at 360dp width on
  Android and on iOS with all eight row kinds present, with no clipped or overlapping rows.

## Assumptions

- **The server fans out over the existing per-domain searches; it does not build a search
  index.** Each domain already owns both a search query and the access rules for its own
  data. A denormalised cross-domain index would duplicate every one of those access rules
  into a second place and need invalidating on every write, which is how search indexes
  come to disagree with the truth. [ASSUMPTION: chosen because it is the smallest change
  that satisfies "each source enforcing its own access rules" and it keeps one owner per
  access rule; revisit only if measured latency makes fan-out untenable.]
- **Access filtering happens in each source's own query, not as a post-filter over a
  larger result set.** Fetching a page and then discarding what the caller may not see
  returns short, unpredictable pages and still reads the data. [ASSUMPTION: consistent with
  how the file source already works, which is the only one of the four new sources that is
  correct today.]
- **Document search becomes access-scoped; the document tree listings are left alone.**
  Drift D49 covers both, but the tree is a different screen with a different failure mode
  and changing it changes what every person sees in the docs sidebar. [ASSUMPTION: scoped
  to search because that is what this feature is about; D49 is narrowed rather than closed,
  and the tree remains a change in its own right.]
- **Calendar visibility gets enforced in search using the rule the organization-wide event
  listing already uses** — organiser, attendee, or `team`/`org_wide` visibility. It is not
  being enforced retroactively across every other calendar read in this feature.
  [ASSUMPTION: reuses an existing shipped predicate rather than inventing a second
  interpretation of the same column; enforcing it everywhere else is a separate correction.]
- **Work item search covers both ordinary tasks and ritual instances**, because to the
  person searching they are the same kind of thing — work with a name and a due date — and
  splitting them would put two nearly identical row types in the list. The row says which
  it is. [ASSUMPTION: derived from the existing work-item model where a ritual instance is
  a task with a kind.]
- **Cross-source relevance scores are not compared directly.** Trigram similarity,
  multilingual full-text relevance and plain text-search rank are produced by different
  matchers and are not on a common scale. Ranking combines each source's own ordering by a
  fixed, documented rule instead of pretending one number means the same thing everywhere.
  [ASSUMPTION: a genuinely unified relevance model would need a shared scoring pipeline,
  which is the search index this spec declines to build.]
- **The mixed list is capped per source and the narrowed list is deeper.** [ASSUMPTION:
  matches the existing web page, which already has an "All" view and per-category tabs.]
- **Search history stays local to the device and is not synchronised.** The recent items
  the mobile search screen already stores are a convenience, not a record; syncing them
  across devices is a privacy decision nobody has asked for. [ASSUMPTION: preserves current
  behaviour; the "messy search history" the product positions against is about a workspace
  being unsearchable, which stories 1 and 2 address, not about remembering past queries.]
- **Autocomplete is unchanged.** The narrower autocomplete calls for people, departments
  and channels keep working as they do; this feature is about the results, not the
  type-ahead. [ASSUMPTION: extending autocomplete to eight sources multiplies per-keystroke
  cost for a suggestion list that is already good enough; add it when the results list
  proves it is needed.]
- **All clients release together**, so the client-side fan-out is replaced outright rather
  than kept alongside the new path.
- **Existing multilingual matching carries over.** Language detection and the multilingual
  matcher already in use for people, departments and messages are what the new sources
  match with where they already use them; this feature does not change how matching works
  inside any source.
