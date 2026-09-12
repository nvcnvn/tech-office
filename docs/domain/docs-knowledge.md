# Documents

A Notion/Confluence-style document system: nested pages, full version history, threaded
comments, cross-document section embeds, and live collaborative editing presence. Owned by
`internal/docs`; contract in `rpc/v1/document.proto`, split across **eight** services.

**Status date: 2026-09-12.** Supersedes specs 016, 045, 046, 049.

## Services

| Service | RPCs |
|---|---|
| `DocumentService` | Create, Get, Update, Delete, List, GetDocumentTree, SearchDocuments, UpdateDocumentStatus, ResolveSlug |
| `DocumentVersionService` | ListVersions, GetVersion, GetVersionDiff, GetBlame |
| `DocumentAccessService` | SetAccess, RemoveAccess, ListAccess, CheckAccess |
| `DocumentFollowerService` | FollowDocument, UnfollowDocument, ListFollowedDocuments |
| `CommentService` | AddComment, AddCommentReply, ResolveComment, ListComments, DeleteComment |
| `SectionEmbedService` | CreateEmbed, GetEmbeddedSection, ListEmbeds, ListIncomingCitations, DeleteEmbed |
| `DocumentEditorService` | JoinDocument, LeaveDocument, UpdateCursor, ListActiveEditors, Heartbeat |
| `DocumentReactionService` | AddReaction, RemoveReaction, GetReactionStats |

## Document

`docs.document`:

- **Identity** — `title`, `slug` in the form `{title-slug}-{base62-uuid}` (unique per org)
- **Type** — `workspace_doc | task_description | project_brief`. `task_description`
  documents belong to a task (see [rituals-tasks.md](rituals-tasks.md#tasks)) and
  `project_brief` documents to a project; both are reached through their owner, and
  `ListRootDocuments` / `ListChildDocuments` filter on `document_type = 'workspace_doc'`
  so neither appears in the workspace docs tree.
- **Hierarchy** — `parent_document_id`, `depth` ≤ 10, `path uuid[]` materialised ancestor
  path
- **Content** — `content_json` (TipTap/ProseMirror JSON) and `content_text` (plain-text
  extraction for full-text search), kept in sync on every write
- **Status** — `active | outdated | archived`; **visibility** — `public | private`
  (root documents only)
- Denormalised `child_count`, `version_count`, `follower_count`

`docs.document_slug_history` keeps old slugs pointing at the document, so renaming never
breaks a shared link. `ResolveSlug` consults it.

## Versions, diff and blame

`docs.document_version` stores a **full content snapshot** per version — complete TipTap
JSON plus plain text, an author, and an optional `summary` acting as a commit message.
There is deliberately **no version pruning**.

Snapshots rather than deltas are what make `GetVersionDiff` and `GetBlame` straightforward:
any two versions can be compared directly, and line attribution is computed from the
snapshot chain rather than replayed.

## Access control

Two layers, and they answer different questions:

1. The interceptor checks the caller holds `docs.view` / `docs.update` / etc. — *may this
   user use the documents feature at all*.
2. `docs.document_access` checks *may this user touch this document*: `grantee_type IN
   ('employee','department')`, `access_level IN ('read_comment','write_update','none')`.
   An explicit `none` is a deny that overrides an inherited grant.

`CheckAccess` exposes the second layer to clients so the UI can hide controls it knows will
fail.

**Link previews are access-scoped by the same rule.** `ListDocumentPreviews` — the query
behind a document card in chat, see
[workspace-navigation.md](workspace-navigation.md#previews) — carries the `COALESCE`
precedence chain copied verbatim from `SearchDocuments`, deny grant included: owner, then
an explicit employee grant (an explicit `none` stops the chain), then the highest inherited
department grant, then `visibility = 'public'`. A document the reader may not read is never
loaded, so pasting its link into a channel tells a reader without access nothing at all.
This replaces an earlier existence-only check on the preview path, which would have
disclosed the title of any document whose id somebody happened to hold.

The linked document's **parent** contributes a name to the card, never access: a visible
child inside a parent the reader cannot open still says which space it is in, and a root
document names the workspace.

### Implicit reads through a ritual procedure

There is a third path into a document's content, and it touches neither layer above.

A ritual definition may name one `workspace_doc` as its written procedure (feature 043, see
[rituals-tasks.md](rituals-tasks.md#the-procedure-document-feature-043)). Anyone who can see
the definition's project can then read that document's title, status and `content_json`
through `CollaborationService.GetRitualProcedure`, with **no** `docs.document_access` row
and without holding a docs permission — an assigned worker who has never been granted
anything on a private document reads it while doing the ritual.

The grant is deliberately narrow. It reaches the current title, status and content of that
one document and **nothing else**:

- it never puts the document in the reader's tree (`ListRootDocuments`,
  `ListChildDocuments`) or in their search results (`SearchDocuments`);
- it does not extend to the document's child pages;
- it confers no comment, reaction, follow, version-history or update rights — every one of
  those still goes through `docs.document_access`, where the reader's own access decides;
- it ends immediately when the attachment is removed or the definition is deleted, because
  nothing is copied and the grant is derived on every read.

Two consequences worth knowing when changing this area. A manager can only attach a document
they can already read: the attachment is validated with `CheckAccess` against the *manager's*
own grants, so the implicit grant can never exceed what the granting manager could see. That
check lives on the write path only — the read path skips it by design, which is the whole
mechanism. And because nothing is snapshotted, editing the document changes what every open
instance shows at once; there is no stored copy of a procedure anywhere.

Related: `SearchDocuments` matches `title` as well as `content_text` (feature 043 made the
procedure chooser title-driven; a document search that could not find a document by its own
name was not a search).

`SearchDocuments` is **access-scoped for every caller** (feature 045). Its SQL carries the
same precedence `documentLogicImpl.CheckAccess` applies, written as a `COALESCE` over scalar
sub-selects rather than an `OR`-chain so the short-circuits survive:

1. `owner_employee_id = @employee_id` → access, unconditionally;
2. otherwise an explicit **employee** grant if one exists — including `'none'`, which is a
   deny that stops the chain even on a public document;
3. otherwise the **highest department** grant among the caller's departments;
4. otherwise `visibility = 'public'` → access;
5. otherwise no access.

The logic method takes `employeeID`, sourced from the auth context. This applies to
`DocumentService.SearchDocuments` as well as to `SearchService.Search`, so the feature-043
procedure chooser no longer offers documents the manager cannot open.

The document **tree listings** (`ListRootDocuments`, `ListChildDocuments`) are still
org-scoped; that half of D49 is open by design, because scoping the sidebar changes what
every person sees in it. See D49 in the drift register.

## Comments and reactions

`docs.comment` with `docs.comment_reply` — one level of threading, resolvable.
`docs.document_reaction` with `GetReactionStats` for aggregate counts.

`GetCommentAuthorAndText` on `DocumentLogic` returns one comment's author and text. It has
no RPC and exists for the compliance domain's report snapshot: going through this method
rather than letting compliance read `docs.comment` directly is what keeps content
reporting free of cross-schema access (Constitution IV). See
[compliance-safety.md](compliance-safety.md).

That path is now reachable from the UI: the web comments panel carries a report control on
every comment the reader did not write (`comment.authorEmployeeId !== user.membershipId`),
and the report's snapshot is the comment text as it stood. Mobile has no comments panel, so
it has no comment report control.

## Section embeds

`docs.section_embed` lets one document quote a line range of another:

- source side: `source_document_id` + `source_line_start/end` (where the embed sits)
- target side: `target_document_id` + `target_line_start/end` (what is quoted)
- `target_version_number` — **a snapshot, not live tracking.** The embed shows the target
  as it was when the embed was created; the target changing later does not silently rewrite
  the quoting document.
- `no_self_embed` CHECK

`ListIncomingCitations` inverts the relation: "which documents quote this one" — the
backlink view.

## Collaborative editing presence

`docs.document_editor` is an **UNLOGGED** table, one row per (document, employee), holding
`connection_id`, `instance_id`, `cursor_position` JSONB (`{block_id, offset}`) and
`last_heartbeat`. Max 10 active editors per document.

This is presence only — cursors and avatars. There is **no OT/CRDT merge**: the system
never merges two people's text. Concurrent edits are resolved by refusing the later one
(see "Edit conflict protection" below), not by character-merging and not by
last-write-wins. `JoinDocument` / `Heartbeat` / `UpdateCursor` / `LeaveDocument` maintain
the row; `ListActiveEditors` reads it.

Note this is a separate heartbeat mechanism from notification presence, which uses the
client-attested ping-pong protocol. The document editor heartbeat is still server-refreshed.

## Edit conflict protection

`UpdateDocument` is a **compare-and-swap on `docs.document.version_count`**. The request
carries a required `base_version` — the `version_count` the editing session loaded, which
every client already receives as `Document.version_count`. Because versions are never
pruned and never renumbered, `version_count` is also the document's current version
number, so no separate concurrency token exists.

The check happens twice on one value. `documentLogicImpl.UpdateDocument` compares
`base_version` against the document it has just read, ahead of the slug-history write, so
a refusal never writes speculatively. The authority is the SQL itself: the `UPDATE` carries
`AND version_count = @base_version`, and zero rows updated is the conflict signal. Two
racing writers serialize on the PostgreSQL row lock, so the guarantee holds across backend
instances with no in-process lock.

A refusal is total. The error propagates out of `txn.WithTxn`, so the transaction rolls
back: no content, no title, no `document_version` row, no slug-history row, no follower
notification. A base version that is behind, ahead, or absent (which arrives as `0`) all
take the same path, so no client can opt back into last-write-wins.

The refusal is reported as `ABORTED` carrying exactly one `rpc.v1.DocumentVersionConflict`
detail (`backend/rpc/v1/docs_error_details.proto`) with the current version number, the
conflicting author's display name, and when they saved. The write-access check runs first,
so a caller who may not edit the document gets `PERMISSION_DENIED` and never learns who
edited. On the web, `extractDocumentVersionConflict` reads the detail and `DocumentEditor`
renders a distinct banner that keeps the person's unsaved text in place and offers "copy my
changes" and "load the current version". Documents are read-only on mobile, which therefore
never sends a base version.

`rpcCall` in `frontend/packages/apis` rethrows `ABORTED` as the original `ConnectError`
rather than flattening it to a `NetworkError`, because the detail is the point.

## Following

`FollowDocument` does **not** write a docs-owned table. It upserts
`notification.resource_subscription` with `resource_domain = 'document'`
(`internal/docs/follower_logic.go`). `document.follower_count` is the denormalised counter.
Comment threads map back to the document through `notification.resource_surface` with
surface type `document_comments`, so commenting on a thread notifies the document's
followers.

## Notifications produced

`doc_updated`, `doc_commented`, `doc_mentioned`, source domain `docs`.

## Client surfaces

- Web: `/workspace/docs`, `/workspace/docs/[slug]`. There is also a **separate static docs
  site** under `apps/web/src/app/docs/` — product guides, feature pages, and owner/employee
  guides — which is marketing/help content, not the document system.
- Mobile: `app/(app)/(more)/docs/index.tsx`, `docs/[slug].tsx` — read-oriented. The route
  segment is named `[slug]` but carries a slug only when the reader came from the docs list
  or search; a canonical link or a notification deep link supplies a document **id**.
  `GetDocument` takes either, so the screen picks the request field from the shape of the
  segment rather than making every caller resolve an id to a slug first. The viewer renders
  its body from the document's `contentJson` — the only content field
  `protoDocumentToNative` populates — and runs one preview lookup over that same text, so a
  canonical link inside a document body becomes a card there under exactly the rules it
  follows in chat. The screen holds no `any`-typed view of the document, which is what keeps
  a reference to a field the API does not return from compiling. The list
  screen serves two differently-shaped sources: `ListDocuments` returns `DocumentSummary`,
  `SearchDocuments` returns `SearchResult`, which wraps a `DocumentSummary` alongside a
  `snippet`. Both are normalised to one row shape in `apps/mobile/src/lib/doc-rows.ts`,
  covered by `doc-rows.check.ts` (`npm run check:doc-rows`), because reading a search hit
  flat fails silently: the row still renders, as "Untitled", linking to `/docs/undefined`.
  Queries are debounced 250ms and only issued at two characters or more; there is no
  client-side re-filtering of server results.
- Client: `packages/apis/src/docs.ts`.

## Tests

`integration/docs_crud_test.go`, `docs_version_test.go`, `docs_diff_test.go`,
`workflow_document_collab_test.go`, `notification_docs_test.go`,
`notification_document_coverage_test.go`, `notification_v2_document_subscription_test.go`,
`collaboration_ritual_procedure_test.go` (the implicit read path).

## Known drift

One thing that reads as drift but is not:

- `DocumentFollowerService` looks like it should own a table; it does not, by design.
  Following lives in the notification domain.
