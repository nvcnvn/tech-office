/**
 * Federated Search (Feature 045)
 *
 * One request, eight sources, one ranked list. The fan-out, the access filtering, the
 * ranking and the truncation all happen on the server, so web and mobile see the same
 * results in the same order by construction. This module used to fan out over four of
 * the eight sources from the client; it no longer fans out at all.
 *
 * Proto enums are converted to string unions at this boundary, so no UI file imports the
 * generated stubs (Constitution VII).
 */

import { searchClient } from './rpc';
import rpcCall from './rpcWrapper';
import { search as searchPb } from 'rpc';
import type {
	SearchHit,
	SearchKind,
	SearchResults,
	SearchTarget,
	SourceOutcome,
	SourceStatus,
} from './types/search';

export type {
	SearchHit,
	SearchKind,
	SearchResults,
	SearchTarget,
	SourceOutcome,
	SourceStatus,
} from './types/search';

/**
 * Every generated SearchKind, mapped to its string union member.
 *
 * A `Record` rather than a `switch`: adding a value to the proto enum without adding it
 * here fails `tsc`, and each client's row map is a `Record<SearchKind, ...>` in turn, so
 * a new kind cannot reach a client as a row nobody knows how to render.
 */
const KIND_BY_PROTO: Record<searchPb.SearchKind, SearchKind | null> = {
	[searchPb.SearchKind.UNSPECIFIED]: null,
	[searchPb.SearchKind.PERSON]: 'person',
	[searchPb.SearchKind.DEPARTMENT]: 'department',
	[searchPb.SearchKind.CHANNEL]: 'channel',
	[searchPb.SearchKind.MESSAGE]: 'message',
	[searchPb.SearchKind.DOCUMENT]: 'document',
	[searchPb.SearchKind.FILE]: 'file',
	[searchPb.SearchKind.WORK_ITEM]: 'work_item',
	[searchPb.SearchKind.EVENT]: 'event',
};

const PROTO_BY_KIND: Record<SearchKind, searchPb.SearchKind> = {
	person: searchPb.SearchKind.PERSON,
	department: searchPb.SearchKind.DEPARTMENT,
	channel: searchPb.SearchKind.CHANNEL,
	message: searchPb.SearchKind.MESSAGE,
	document: searchPb.SearchKind.DOCUMENT,
	file: searchPb.SearchKind.FILE,
	work_item: searchPb.SearchKind.WORK_ITEM,
	event: searchPb.SearchKind.EVENT,
};

const STATUS_BY_PROTO: Record<searchPb.SourceStatus, SourceStatus> = {
	// UNSPECIFIED is what a source outside a narrowed search reports: it was not queried,
	// which is neither an answer nor a failure.
	[searchPb.SourceStatus.UNSPECIFIED]: 'not_searched',
	[searchPb.SourceStatus.OK]: 'ok',
	[searchPb.SourceStatus.UNAVAILABLE]: 'unavailable',
	[searchPb.SourceStatus.NOT_PERMITTED]: 'not_permitted',
};

function protoTargetToNative(target: searchPb.SearchTarget | undefined): SearchTarget {
	return {
		employeeId: target?.employeeId ?? '',
		departmentId: target?.departmentId ?? '',
		channelId: target?.channelId ?? '',
		messageId: target?.messageId ?? '',
		documentSlug: target?.documentSlug ?? '',
		fileId: target?.fileId ?? '',
		projectId: target?.projectId ?? '',
		taskId: target?.taskId ?? '',
		eventId: target?.eventId ?? '',
	};
}

/** Human-readable plural name for a kind, for "documents could not be searched". */
export function searchKindLabel(kind: SearchKind): string {
	switch (kind) {
		case 'person':
			return 'People';
		case 'department':
			return 'Departments';
		case 'channel':
			return 'Channels';
		case 'message':
			return 'Messages';
		case 'document':
			return 'Documents';
		case 'file':
			return 'Files';
		case 'work_item':
			return 'Work items';
		case 'event':
			return 'Events';
	}
}

export interface SearchOptions {
	/** What was typed. Trimmed server-side; fewer than 2 characters is rejected. */
	query: string;
	/** Omit for the mixed list; set to narrow to one kind and get a deeper list of it. */
	kindFilter?: SearchKind;
	/** Clamped server-side, never rejected. Mixed: default 40, max 80. Narrowed: 20 / 50. */
	limit?: number;
}

/**
 * Search every source the caller is permitted to search.
 *
 * @returns One ranked list, already merged and capped, plus a per-source outcome report.
 *   A source that failed is named in `outcomes`, not silently missing from `hits`.
 *
 * @example
 * ```ts
 * const { hits, outcomes } = await search({ query: 'invoice' });
 * const broken = outcomes.filter((o) => o.status === 'unavailable');
 * ```
 */
export async function search({ query, kindFilter, limit }: SearchOptions): Promise<SearchResults> {
	const response = await rpcCall(() =>
		searchClient.search({
			query,
			kindFilter: kindFilter ? PROTO_BY_KIND[kindFilter] : searchPb.SearchKind.UNSPECIFIED,
			limit: limit ?? 0,
		})
	);

	const hits: SearchHit[] = [];
	for (const hit of response.hits) {
		const kind = KIND_BY_PROTO[hit.kind];
		// A server sending a kind this build has never heard of is a deploy skew, not a
		// contract break: drop the row rather than render one nothing can open.
		if (!kind) continue;
		hits.push({
			kind,
			title: hit.title,
			contextLine: hit.contextLine,
			snippet: hit.snippet,
			rank: hit.rank,
			target: protoTargetToNative(hit.target),
		});
	}

	const outcomes: SourceOutcome[] = [];
	for (const outcome of response.outcomes) {
		const kind = KIND_BY_PROTO[outcome.kind];
		if (!kind) continue;
		outcomes.push({
			kind,
			status: STATUS_BY_PROTO[outcome.status] ?? 'not_searched',
			hitCount: outcome.hitCount,
			detail: outcome.detail,
		});
	}

	return { hits, outcomes };
}
