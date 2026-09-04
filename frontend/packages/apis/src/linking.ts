/**
 * Canonical link previews (feature 046).
 *
 * One request per rendered page of messages, not one per message: the list component
 * collects the distinct canonical URLs it is about to render and asks once. Both apps go
 * through here so they share one base-URL resolution and one cache, instead of the three
 * hand-rolled `fetch` calls this replaces.
 */

import type { CanonicalLinkPreview } from '@tech-office/links';

import { getRPCBaseUrl } from './rpc';
import { getAuthToken } from './token';

/**
 * The backend rejects a request carrying more than this many URLs rather than truncating
 * it. Mirrors `linking.MaxPreviewURLsPerRequest` in Go — the two must move together.
 */
export const MAX_PREVIEW_URLS_PER_REQUEST = 20;

/**
 * Resolved previews for this session, keyed by canonical URL. A resource linked from
 * twenty messages is looked up once (FR-021).
 *
 * The cache is scoped to the reader by the token that filled it: `readerCache()` drops
 * everything the moment the access token changes, so one reader's entitlements can never
 * answer for another's. Scoping here rather than having clearAuthToken() reach in keeps
 * `token.ts` free of a dependency on this module — the two imported each other and the
 * resulting require cycle left `getAuthToken` uninitialised on a cold Metro start.
 *
 * There is deliberately no server-side equivalent — a cache keyed by entitlement would
 * have to be invalidated whenever a project goes private, and getting that wrong is a
 * disclosure rather than a stale card.
 */
const previewCache = new Map<string, CanonicalLinkPreview | null>();

/** Requests already in flight, so two lists rendering at once ask once. */
const inFlight = new Map<string, Promise<void>>();

/** The token the cache above was filled for, and a counter that invalidates in-flight writes. */
let cacheToken: string | null = null;
let cacheGeneration = 0;

/**
 * Returns the current access token, emptying the cache first if it belongs to a different
 * reader than the one that filled it. Sign-out, sign-in and a token swap all land here.
 */
async function readerCache(): Promise<string | null> {
	const token = await getAuthToken();
	if (token !== cacheToken) {
		previewCache.clear();
		inFlight.clear();
		cacheToken = token;
		cacheGeneration += 1;
	}
	return token;
}

export interface LinkPreviewItem {
	url: string;
	status: 'ok' | 'unavailable';
	preview?: CanonicalLinkPreview;
}

interface LinkPreviewsResponse {
	items?: LinkPreviewItem[];
}

/**
 * Resolves previews for a set of canonical links in one request.
 *
 * Never throws. A failed lookup resolves to an empty map, which renders as raw clickable
 * links rather than as an error — one unreachable preview must not cost the reader the
 * message it was attached to (FR-015, FR-023).
 */
export async function fetchCanonicalPreviews(urls: string[]): Promise<Map<string, CanonicalLinkPreview>> {
	const wanted = Array.from(new Set(urls.filter(Boolean))).slice(0, MAX_PREVIEW_URLS_PER_REQUEST);
	if (wanted.length === 0) {
		return new Map();
	}
	const token = await readerCache();

	// Anything already answered this session, or already being asked about, is not asked
	// again. What is left is one request for the whole remainder.
	const pending = wanted.filter((url) => !previewCache.has(url) && !inFlight.has(url));
	if (pending.length > 0) {
		const request = lookup(pending, token);
		for (const url of pending) {
			inFlight.set(url, request);
		}
	}
	await Promise.all(wanted.map((url) => inFlight.get(url)).filter(Boolean));

	const resolved = new Map<string, CanonicalLinkPreview>();
	for (const url of wanted) {
		const preview = previewCache.get(url);
		if (preview) {
			resolved.set(url, preview);
		}
	}
	return resolved;
}

/**
 * One request. Never throws: on failure every requested url is left uncached, so the next
 * render retries rather than remembering a network blip as "no such resource".
 */
async function lookup(urls: string[], token: string | null): Promise<void> {
	const generation = cacheGeneration;
	try {
		const response = await fetch(`${trimTrailingSlash(getRPCBaseUrl())}/api/linking/previews`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({ urls }),
		});
		if (!response.ok) {
			return;
		}
		const payload = (await response.json()) as LinkPreviewsResponse;
		// The reader changed while this request was open: these answers belong to whoever
		// asked, not to whoever is signed in now.
		if (generation !== cacheGeneration) {
			return;
		}
		for (const item of payload.items ?? []) {
			// An unavailable url is cached as null: "this reader gets no card for this
			// link" is an answer, and re-asking it on every scroll is the cost US3 exists
			// to remove.
			previewCache.set(item.url, item.status === 'ok' && item.preview ? item.preview : null);
		}
	} catch {
		// Network or parse failure: no cards, raw links, no banner.
	} finally {
		// Only retire our own entries: after a reader change the map may already hold a
		// new request for the same urls.
		if (generation === cacheGeneration) {
			for (const url of urls) {
				inFlight.delete(url);
			}
		}
	}
}

function trimTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}
