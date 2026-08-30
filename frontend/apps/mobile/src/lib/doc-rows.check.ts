/**
 * Self-check for document row normalisation. Run with `npm run check:doc-rows`.
 *
 * The bug this guards is silent: a search hit whose fields are read at the wrong
 * level still renders, it just renders as "Untitled" and links to
 * /docs/undefined. Nothing throws, so only an assertion catches it.
 */

import assert from "node:assert/strict";
import {
  docRouteSegment,
  searchHitsToDocRows,
  toDocRows,
} from "./doc-rows.ts";

const doc = (over: Partial<any> = {}) =>
  ({
    id: "doc-1",
    title: "Onboarding",
    slug: "onboarding",
    parentDocumentId: "",
    depth: 0,
    status: "published",
    visibility: "organization",
    ownerName: "Ada",
    childCount: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  }) as any;

// A search hit carries the document one level down. Reading it flat is the bug.
{
  const rows = searchHitsToDocRows([
    { document: doc(), snippet: "…onboarding checklist…", score: 0.9, isEmbedded: false },
  ] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document.title, "Onboarding", "search hits must keep their title");
  assert.equal(rows[0].snippet, "…onboarding checklist…");
  assert.equal(docRouteSegment(rows[0].document), "onboarding");
}

// A hit with no document at all must be dropped, not rendered as a blank row.
{
  const rows = searchHitsToDocRows([{ snippet: "orphan", score: 0.1 }] as any);
  assert.equal(rows.length, 0, "a hit without a document is not a row");
}

// An empty snippet is absent, not an empty line under the title.
{
  const rows = searchHitsToDocRows([{ document: doc(), snippet: "", score: 0 }] as any);
  assert.equal(rows[0].snippet, undefined);
}

// Plain listing rows carry no snippet and route by slug.
{
  const rows = toDocRows([doc(), doc({ id: "doc-2", slug: "", title: "Slugless" })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].snippet, undefined);
  assert.equal(docRouteSegment(rows[1].document), "doc-2", "no slug falls back to the id");
}

// Both sources tolerate a missing payload rather than throwing on a failed call.
assert.deepEqual(toDocRows(undefined), []);
assert.deepEqual(searchHitsToDocRows(undefined), []);

console.log("doc-rows: all checks passed");
