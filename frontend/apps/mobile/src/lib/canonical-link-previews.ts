/**
 * One preview lookup per rendered page of messages (feature 046).
 *
 * Both chat screens — the channel and the thread — collect the distinct canonical URLs
 * they are about to render and ask once, then hand the map down to ChatMessageBody. The
 * cost of a page is therefore proportional to the distinct resources it links, not to the
 * number of messages (FR-020, SC-005), and the map starts empty so message text renders
 * without waiting on it (FR-022).
 */

import { useEffect, useMemo, useState } from "react";

import { fetchCanonicalPreviews, MAX_PREVIEW_URLS_PER_REQUEST } from "apis";
import { extractCanonicalResourceLinks, type CanonicalLinkPreview } from "@tech-office/links";

/** Distinct canonical urls looked up for one page. Matches the backend's request bound. */
export const MAX_PREVIEW_LOOKUP = MAX_PREVIEW_URLS_PER_REQUEST;

export function useCanonicalLinkPreviews(
  messageTexts: Array<string | undefined | null>,
): Map<string, CanonicalLinkPreview> {
  const [previews, setPreviews] = useState<Map<string, CanonicalLinkPreview>>(new Map());

  // Keyed on the urls themselves, so scrolling within an already-resolved page does not
  // re-request while a page of new messages does.
  //
  // Callers pass the texts in the order they want the cap spent: the channel screen holds
  // messages newest-first, so filling from the front is what keeps a just-posted message
  // from being the one left without a card.
  const urlKey = useMemo(() => {
    const urls = new Set<string>();
    for (const text of messageTexts) {
      for (const url of extractCanonicalResourceLinks(text || "")) {
        urls.add(url);
        if (urls.size >= MAX_PREVIEW_LOOKUP) break;
      }
      if (urls.size >= MAX_PREVIEW_LOOKUP) break;
    }
    return Array.from(urls).join("\n");
  }, [messageTexts]);

  useEffect(() => {
    if (!urlKey) {
      setPreviews(new Map());
      return;
    }
    let cancelled = false;
    void fetchCanonicalPreviews(urlKey.split("\n")).then((resolved) => {
      if (!cancelled) setPreviews(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [urlKey]);

  return previews;
}
