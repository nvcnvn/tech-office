# Docs workspace page

This page documents how the **Docs** workspace implements **citations** (line links) and **embeds** (inline excerpts from another document).

## What we ship today (important)

- Citations and embeds are **line-range-based**, using URL fragments like `#L10` or `#L10-L15`.
- In rendered document view, those lines are **rendered/citable document lines**, not raw markdown source lines:
  - headings, list items, paragraph hard breaks, blockquotes, and code content lines count as displayed lines
  - markdown-only syntax such as code fences and serializer trailing newlines does not count
  - embed nodes count as one citation anchor even if the embedded card is visually tall
- Embeds are stored in Postgres table `docs.section_embed` as:
  - `source_document_id`, `source_line_start/end`
  - `target_document_id`, `target_line_start/end`
  - optional `target_version_number` (locks the embed to a specific target version)
- The embed content is rendered by slicing `content_json` with the same rendered/citable line model. `content_text` is only a fallback for older or invalid payloads.

This is intentionally different from earlier “block-id / section-anchor” research ideas.

## How to use

### 1) Create a citation link (copy a `#L...` URL)

1. Open a document in the Docs workspace.
2. Use the line number gutter (LineNumberSidebar) to select a single line or a range.
3. Click the copy button.

URL formats:
- Single line: `/workspace/docs?slug={slug}#L{n}`
- Line range: `/workspace/docs?slug={slug}#L{start}-L{end}`

### 2) Create an embed (paste a citation link)

1. While editing a document, paste a citation link (one of the formats above).
2. The editor intercepts the paste and:
   - resolves the target document (by `slug` or `doc` id)
   - calls the backend to create an embed record
   - inserts a TipTap node of type `embed` with `embedId`
3. The embed renders inline as a boxed excerpt.

Notes:
- The editor also accepts `/workspace/docs?doc={uuid}#L...` links.
- Embeds do **not** update the target document; they only reference it.

## Permissions & behavior

- Creating an embed requires:
  - **write** access to the source document
  - **read** access to the target document
- Viewing an embed:
  - if the viewer cannot access the target, the backend returns `targetAccessible=false` and the UI shows an “no access” message.

## Version staleness

If an embed was created with `target_version_number` set, the UI can mark it as **outdated** when `target_version_number < target_latest_version`.

## Where the code lives

Frontend:
- `LineNumberSidebar`: generates `#L...` links
- `DocumentEditor`: paste handler creates embeds
- `EmbedNode` + `EmbeddedSection`: renders embeds

Backend:
- `SectionEmbedService` (Connect RPC)
- `backend/internal/docs/embed_logic.go`: core validation, persistence, circular detection

Database:
- `docs.section_embed`
- `content_json` is used for line extraction so embedded excerpts match the visible line-number model

## Debugging

### Quick checklist

1. **Does the pasted URL match the expected format?**
   - Must contain `/workspace/docs` and a `#L...` fragment.
2. **Does the target doc resolve?**
   - `?slug=...` must be a valid current slug.
   - `?doc=...` must be a valid UUID.
3. **Do you have access?**
   - Create embed: write to source + read to target.
   - View embed: read to target.

### Frontend debugging

- Open DevTools Console:
  - Look for `Failed to create embed:` from the editor paste handler.
- Inspect the embed node:
  - TipTap stores `embedId` in the document JSON; if it’s missing, the RPC likely failed or paste didn’t match.

### Backend debugging

- Server logs include `DocumentLogic.CreateEmbed` with `sourceDocID`, `targetDocID`, and `targetLines`.
- Common error cases:
  - Invalid line ranges → `InvalidArgument`
  - Self-embed → rejected
  - Circular embeds → rejected
  - Missing target doc → rejected

### Database debugging (local)

Use `docker compose exec postgres psql ...` (see AGENTS.md) and query:

- Confirm the embed record exists:
  - `select * from docs.section_embed order by updated_at desc limit 20;`
- Confirm the embed record line range matches the rendered document model shown in the frontend.

If the target document has fewer rendered/citable lines than the embed’s `target_line_end`, the UI will show “Unable to extract content”.
