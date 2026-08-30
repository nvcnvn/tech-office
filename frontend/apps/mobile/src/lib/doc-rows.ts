/**
 * Normalising the two document-list shapes into one row shape.
 *
 * listDocuments returns DocumentSummary; searchDocuments returns SearchResult,
 * which wraps a DocumentSummary in { document, snippet, score }. The docs screen
 * read title/slug/updatedAt off both, so every search hit rendered as "Untitled"
 * and navigated to /docs/undefined. Keeping the unwrapping here, as a pure
 * function, is what lets a check prove it stays right.
 */

import type { DocumentSummary, SearchResult } from "apis";

export interface DocRow {
  document: DocumentSummary;
  /** Matching text from the server, present only for search hits. */
  snippet?: string;
}

export function toDocRows(documents: DocumentSummary[] | undefined): DocRow[] {
  return (documents ?? []).map((document) => ({ document }));
}

export function searchHitsToDocRows(results: SearchResult[] | undefined): DocRow[] {
  return (results ?? [])
    .filter((hit): hit is SearchResult => Boolean(hit?.document))
    .map((hit) => ({ document: hit.document, snippet: hit.snippet || undefined }));
}

/** The path segment a row navigates to: the slug, or the id when there is none. */
export function docRouteSegment(document: DocumentSummary): string {
  return document.slug || document.id;
}
