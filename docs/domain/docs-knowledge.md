# Documents

A Notion/Confluence-style document system: nested pages, full version history, threaded
comments, cross-document section embeds, and live collaborative editing presence. Owned by
`internal/docs`; contract in `rpc/v1/document.proto`, split across **eight** services.

**Status date: 2026-08-27.** Supersedes spec 016.

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

## Comments and reactions

`docs.comment` with `docs.comment_reply` — one level of threading, resolvable.
`docs.document_reaction` with `GetReactionStats` for aggregate counts.

`GetCommentAuthorAndText` on `DocumentLogic` returns one comment's author and text. It has
no RPC and exists for the compliance domain's report snapshot: going through this method
rather than letting compliance read `docs.comment` directly is what keeps content
reporting free of cross-schema access (Constitution IV). See
[compliance-safety.md](compliance-safety.md).

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

This is presence only — cursors and avatars. There is **no OT/CRDT merge**: concurrent
edits are resolved last-write-wins at the version level, not character-merged. `JoinDocument`
/ `Heartbeat` / `UpdateCursor` / `LeaveDocument` maintain the row; `ListActiveEditors`
reads it.

Note this is a separate heartbeat mechanism from notification presence, which uses the
client-attested ping-pong protocol. The document editor heartbeat is still server-refreshed.

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
- Mobile: `app/(app)/(more)/docs/index.tsx`, `docs/[slug].tsx` — read-oriented.
- Client: `packages/apis/src/docs.ts`.

## Tests

`integration/docs_crud_test.go`, `docs_version_test.go`, `docs_diff_test.go`,
`workflow_document_collab_test.go`, `notification_docs_test.go`,
`notification_document_coverage_test.go`, `notification_v2_document_subscription_test.go`.

## Known drift

Two things that read as drift but are not:

- `DocumentFollowerService` looks like it should own a table; it does not, by design.
  Following lives in the notification domain.
- `SearchDocuments` exists and works but is **not** wired into the federated search box —
  see [D5](workspace-navigation.md#known-drift).
