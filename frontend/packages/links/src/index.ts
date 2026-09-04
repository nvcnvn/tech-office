/**
 * At most this many preview cards render for one message; the rest of that message's
 * canonical links stay raw clickable text (FR-013). Matches the existing task-chip cap.
 */
export const MAX_PREVIEW_CARDS = 3;

/** A card shows at most this many supporting lines, each bounded to this many characters. */
const MAX_PREVIEW_LINES = 2;
const MAX_PREVIEW_LINE_LENGTH = 120;

export type CanonicalResourceType =
	| 'task'
	| 'chat'
	| 'thread'
	| 'message'
	| 'project'
	| 'workspace'
	| 'document'
	| 'calendar'
	| 'booking';

export interface CanonicalLinkTarget {
	tenantKey: string;
	resourceType: CanonicalResourceType;
	resourceId: string;
	parentResourceId?: string;
	focusIntent?: string;
	entryContext?: string;
	requirementId?: string;
	anchorType?: string;
	anchorId?: string;
}

export interface CanonicalLinkResolution {
	status: 'ok' | 'auth_required' | 'access_denied' | 'not_found' | 'fallback';
	normalizedTarget: CanonicalLinkTarget;
	webRoute?: string;
	mobileRoute?: string;
	requiresAuthentication?: boolean;
	fallbackUrl?: string;
	ignoredContext?: string[];
	legacyNormalized?: boolean;
}

/**
 * One card's worth of resource data, composed per reader by the backend and never from the
 * URL. The supporting line is composed here rather than server-side because the reader's
 * time zone is only known on the client, which is why `startTime` arrives as an instant.
 */
export interface CanonicalLinkPreview {
	title: string;
	subtitle?: string;
	resourceType: CanonicalResourceType;
	href: string;
	badge?: string;
	/** Human-readable id: a task's `OPS-142`, a project's key. */
	identifier?: string;
	stateName?: string;
	stateCategory?: string;
	/** The earliest assignee; `assigneeCount` drives the `+N` suffix. */
	assigneeName?: string;
	assigneeCount?: number;
	/** RFC3339 instant, formatted in the reader's own zone. */
	startTime?: string;
	allDay?: boolean;
}

export interface CanonicalLinkTextSegment {
	kind: 'text' | 'link';
	value: string;
}

/** One rendered card: the link that produced it, and the text to draw. */
export interface CanonicalPreviewCard {
	url: string;
	display: CanonicalLinkPreviewDisplay;
}

export interface SelectCanonicalPreviewCardsOptions {
	/**
	 * Tasks the surrounding message already shows as conversion chips. A card is
	 * suppressed for each of them: the chip is the authoritative representation of that
	 * relationship, and a card beside it would say the same thing twice (FR-018).
	 */
	suppressedTaskIds?: Iterable<string>;
}

export interface CanonicalLinkPreviewDisplay {
	badge: string;
	title: string;
	/** Supporting lines, already composed. At most two, already truncated. */
	lines: string[];
	href: string;
}

export interface SplitCanonicalLinkTextOptions {
	/** Drop canonical links from the output instead of emitting them as link segments. */
	omitLinks?: boolean;
	/**
	 * Restricts `omitLinks` to these exact URLs. Without it every canonical link is
	 * dropped; with it, a link that produced no card keeps its raw text (FR-016).
	 */
	omitUrls?: readonly string[];
}

type CanonicalContextKey = (typeof allowedQueryKeys)[number];

const allowedQueryKeys = ['focusIntent', 'entryContext', 'requirementId', 'anchorType', 'anchorId'] as const;
const urlCandidatePattern = /https?:\/\/[^\s<>"']+/gi;
const hrefCandidatePattern = /href\s*=\s*(['"])(.*?)\1/gi;
const anchorTagPattern = /<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
const resourceTypeLabels: Record<CanonicalResourceType, string> = {
	task: 'Task',
	chat: 'Chat',
	thread: 'Thread',
	message: 'Message',
	project: 'Project',
	workspace: 'Workspace',
	document: 'Document',
	calendar: 'Calendar event',
	booking: 'Booking',
};

export function isCanonicalResourceLink(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		const parts = trimPath(url.pathname).split('/');
		return parts.length >= 5 && parts[0] === 'o' && parts[2] === 'r';
	} catch {
		return false;
	}
}

export function parseCanonicalResourceLink(rawUrl: string): CanonicalLinkTarget | null {
	try {
		const url = new URL(rawUrl);
		const parts = trimPath(url.pathname).split('/');
		if (parts.length < 5 || parts[0] !== 'o' || parts[2] !== 'r') {
			return null;
		}
		if (!isCanonicalResourceType(parts[3])) {
			return null;
		}
		const target: CanonicalLinkTarget = {
			tenantKey: parts[1],
			resourceType: parts[3],
			resourceId: parts[4],
		};
		for (const key of allowedQueryKeys) {
			const value = url.searchParams.get(key);
			if (value) {
				setContextValue(target, key, value);
			}
		}
		return target;
	} catch {
		return null;
	}
}

export function buildCanonicalResourceLink(origin: string, target: CanonicalLinkTarget): string {
	const url = new URL(`/o/${target.tenantKey}/r/${target.resourceType}/${target.resourceId}`, origin);
	for (const key of allowedQueryKeys) {
		const value = getContextValue(target, key);
		if (value) {
			url.searchParams.set(key, value);
		}
	}
	return url.toString();
}

export function extractCanonicalResourceLinks(rawContent: string): string[] {
	if (!rawContent) {
		return [];
	}
	const matches: string[] = [];
	for (const candidate of collectHtmlHrefCandidates(rawContent)) {
		if (isCanonicalResourceLink(candidate)) {
			matches.push(candidate);
		}
	}
	for (const candidate of collectURLCandidates(rawContent)) {
		if (isCanonicalResourceLink(candidate)) {
			matches.push(candidate);
		}
	}
	return Array.from(new Set(matches));
}

export function extractFirstCanonicalResourceLink(rawContent: string): string | null {
	return extractCanonicalResourceLinks(rawContent)[0] ?? null;
}

export function splitTextByCanonicalResourceLinks(rawText: string, options: SplitCanonicalLinkTextOptions = {}): CanonicalLinkTextSegment[] {
	if (!rawText) {
		return [];
	}
	const segments: CanonicalLinkTextSegment[] = [];
	let cursor = 0;
	let matchedCanonicalLink = false;
	urlCandidatePattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = urlCandidatePattern.exec(rawText)) !== null) {
		const candidate = normalizeCandidateURL(match[0]);
		if (!candidate || !isCanonicalResourceLink(candidate)) {
			continue;
		}
		matchedCanonicalLink = true;
		const start = match.index;
		const end = start + match[0].length;
		if (start > cursor) {
			segments.push({ kind: 'text', value: rawText.slice(cursor, start) });
		}
		const omit = options.omitLinks && (!options.omitUrls || options.omitUrls.includes(candidate));
		if (!omit) {
			segments.push({ kind: 'link', value: candidate });
		}
		cursor = end;
	}
	if (cursor < rawText.length) {
		segments.push({ kind: 'text', value: rawText.slice(cursor) });
	}
	// An empty result means either "nothing matched" or "everything matched and was
	// omitted". Only the first deserves the whole text back: a message that is nothing but
	// a canonical link must end up empty once its card has taken the link, or the reader
	// gets the card *and* the raw url underneath it.
	if (segments.length === 0 && !matchedCanonicalLink) {
		return [{ kind: 'text', value: rawText }];
	}
	return segments;
}

/**
 * Strips only the URLs that produced a card. Every other canonical link keeps its raw
 * text, so a link the reader may not preview still leaves them something to click
 * (FR-016). Removing all of them, as this used to, left such a reader with neither a card
 * nor a link.
 */
export function removeCanonicalResourceLinksFromContent(rawContent: string, urls: readonly string[]): string {
	if (!rawContent || urls.length === 0) {
		return rawContent ?? '';
	}

	const withoutCanonicalAnchors = rawContent.replace(anchorTagPattern, (_match, _quote: string, href: string, label: string) => {
		const candidate = normalizeCandidateURL(href);
		if (!candidate || !isCanonicalResourceLink(candidate) || !urls.includes(candidate)) {
			return _match;
		}
		const strippedLabel = stripHtmlTags(label).trim();
		return strippedLabel && !isCanonicalResourceLink(strippedLabel) ? strippedLabel : '';
	});

	return splitTextByCanonicalResourceLinks(withoutCanonicalAnchors, { omitLinks: true, omitUrls: urls })
		.map((segment) => segment.value)
		.join('')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Chooses which of a message's canonical links become cards, in the order the links
 * appear. Four rules, all of them per link rather than per message:
 *
 *  - only a link the backend resolved for this reader gets a card (FR-015);
 *  - the same resource linked twice gets one card (FR-014);
 *  - a task the message already shows as a conversion chip gets none (FR-018);
 *  - at most MAX_PREVIEW_CARDS; the overflow keeps its raw clickable text (FR-013).
 *
 * This lives here rather than in each app for the same reason the display formatter does:
 * two copies of "which links become cards" is two behaviours waiting to drift apart.
 */
export function selectCanonicalPreviewCards(
	messageText: string,
	previews: ReadonlyMap<string, CanonicalLinkPreview> | undefined,
	options: SelectCanonicalPreviewCardsOptions = {}
): CanonicalPreviewCard[] {
	const cards: CanonicalPreviewCard[] = [];
	if (!previews || previews.size === 0) {
		return cards;
	}
	const suppressed = new Set(options.suppressedTaskIds ?? []);
	const seen = new Set<string>();

	for (const url of extractCanonicalResourceLinks(messageText)) {
		if (cards.length >= MAX_PREVIEW_CARDS) break;
		const preview = previews.get(url);
		if (!preview) continue;

		const target = parseCanonicalResourceLink(url);
		if (target) {
			if (target.resourceType === 'task' && suppressed.has(target.resourceId)) continue;
			const key = `${target.resourceType}/${target.resourceId}`;
			if (seen.has(key)) continue;
			seen.add(key);
		}
		cards.push({ url, display: buildCanonicalLinkPreviewDisplay(preview) });
	}
	return cards;
}

/**
 * Composes a card's badge, title and supporting lines. This is the only place that
 * composition happens, so a task card reads identically on web and on mobile.
 *
 * Every input is resource data the backend already scoped to this reader; nothing is
 * derived from the URL, which is what the deleted `describeCanonicalResourceLink` did.
 */
export function buildCanonicalLinkPreviewDisplay(preview: CanonicalLinkPreview): CanonicalLinkPreviewDisplay {
	const isChannel = preview.resourceType === 'chat' || preview.resourceType === 'thread';
	return {
		badge: preview.badge || resourceTypeLabels[preview.resourceType],
		title: truncateLine(isChannel ? withChannelPrefix(preview.title) : preview.title),
		lines: previewSupportingLines(preview).slice(0, MAX_PREVIEW_LINES),
		href: preview.href,
	};
}

function previewSupportingLines(preview: CanonicalLinkPreview): string[] {
	switch (preview.resourceType) {
		case 'task': {
			// Identifier, state and assignee on one line; a segment the task does not have
			// is omitted rather than rendered blank.
			const segments = [preview.identifier, preview.stateName, formatAssignee(preview)].filter(
				(segment): segment is string => Boolean(segment)
			);
			return segments.length > 0 ? [truncateLine(segments.join(' · '))] : [];
		}
		case 'document':
			return preview.subtitle ? [truncateLine(`in ${preview.subtitle}`)] : [];
		case 'calendar': {
			const when = formatEventStart(preview);
			return when ? [when] : [];
		}
		case 'thread':
			return ['Thread'];
		case 'chat':
			return [];
		default:
			return preview.subtitle ? [truncateLine(preview.subtitle)] : [];
	}
}

/**
 * Names the first assignee and counts the rest. Listing every assignee would let one card
 * grow without bound, which the display cap exists to prevent.
 */
function formatAssignee(preview: CanonicalLinkPreview): string | undefined {
	if (!preview.assigneeName) {
		return undefined;
	}
	const others = (preview.assigneeCount ?? 1) - 1;
	return others > 0 ? `${preview.assigneeName} +${others}` : preview.assigneeName;
}

/**
 * Formats the event's start in the reader's own zone. An all-day event has no wall clock,
 * so showing one would be a claim the data does not make.
 */
function formatEventStart(preview: CanonicalLinkPreview): string | undefined {
	if (!preview.startTime) {
		return undefined;
	}
	const start = new Date(preview.startTime);
	if (Number.isNaN(start.getTime())) {
		return undefined;
	}
	const options: Intl.DateTimeFormatOptions = preview.allDay
		? { dateStyle: 'medium' }
		: { dateStyle: 'medium', timeStyle: 'short' };
	try {
		return new Intl.DateTimeFormat(undefined, options).format(start);
	} catch {
		return start.toISOString();
	}
}

function withChannelPrefix(title: string): string {
	return title.startsWith('#') ? title : `#${title}`;
}

function truncateLine(value: string): string {
	return value.length <= MAX_PREVIEW_LINE_LENGTH ? value : `${value.slice(0, MAX_PREVIEW_LINE_LENGTH - 1)}\u2026`;
}

export function canonicalTargetToWebPath(target: CanonicalLinkTarget): string | null {
	switch (target.resourceType) {
		case 'task':
			return withQuery(taskWebPath(target), target);
		case 'project':
			return `/workspace/projects/${target.resourceId}`;
		case 'chat':
			return withQuery(target.resourceId ? `/workspace/chat?channel=${encodeURIComponent(target.resourceId)}` : '/workspace/chat', target, {
				preserveExistingQuery: true,
			});
		case 'thread':
			return '/workspace/chat';
		case 'message':
			return '/workspace/chat';
		case 'document':
			return `/workspace/docs/${target.resourceId}`;
		case 'calendar':
			return `/workspace/calendar/${target.resourceId}`;
		case 'booking':
			return `/workspace/calendar/booking/${target.resourceId}`;
		case 'workspace':
			return '/workspace';
		default:
			return null;
	}
}

export function canonicalTargetToMobilePath(target: CanonicalLinkTarget): string | null {
	switch (target.resourceType) {
		case 'task':
			return withQuery(taskMobilePath(target), target);
		case 'project':
			return `/(app)/(tasks)/${target.resourceId}`;
		case 'chat':
			return chatMobilePath(target);
		case 'thread':
			return threadMobilePath(target);
		case 'message':
			// A message anchor has no dedicated mobile screen; the fallback sheet
			// opens the containing channel instead of incorrectly mapping message ID as thread ID.
			return null;
		case 'document':
			return `/(app)/(more)/docs/${target.resourceId}`;
		case 'calendar':
			return `/(app)/(calendar)/${target.resourceId}`;
		case 'booking':
			// No booking detail screen exists in the mobile router; fall through to calendar.
			return null;
		case 'workspace':
			return '/(app)';
		default:
			return null;
	}
}

export function canonicalTargetToWebFallbackPath(target: CanonicalLinkTarget): string | null {
	switch (target.resourceType) {
		case 'task':
			if (target.parentResourceId) {
				return `/workspace/projects/${target.parentResourceId}`;
			}
			return '/workspace/tasks';
		case 'thread':
		case 'message':
		case 'chat':
			return '/workspace/chat';
		case 'document':
			return '/workspace/docs';
		case 'calendar':
		case 'booking':
			return '/workspace/calendar';
		default:
			return canonicalTargetToWebPath(target);
	}
}

export function canonicalTargetToMobileFallbackPath(target: CanonicalLinkTarget): string | null {
	switch (target.resourceType) {
		case 'task':
			if (target.parentResourceId) {
				return `/(app)/(tasks)/${target.parentResourceId}`;
			}
			return '/(app)/(tasks)';
		case 'chat':
			return chatMobilePath(target);
		case 'thread':
			return threadMobilePath(target);
		case 'message':
			return '/(app)/(chat)';
		case 'document':
			return '/(app)/(more)/docs';
		case 'calendar':
		case 'booking':
			return '/(app)/(calendar)';
		default:
			return canonicalTargetToMobilePath(target);
	}
}

export function withParentResource(target: CanonicalLinkTarget, parentResourceId?: string): CanonicalLinkTarget {
	if (!parentResourceId) {
		return target;
	}
	return {
		...target,
		parentResourceId,
	};
}

function withQuery(basePath: string, target: CanonicalLinkTarget, options?: { preserveExistingQuery?: boolean }): string {
	const [pathname, existingQuery = ''] = basePath.split('?', 2);
	const params = new URLSearchParams(options?.preserveExistingQuery ? existingQuery : '');
	for (const key of allowedQueryKeys) {
		const value = getContextValue(target, key);
		if (value) {
			params.set(key, value);
		}
	}
	const queryString = params.toString();
	return queryString ? `${pathname}?${queryString}` : pathname;
}

function taskWebPath(target: CanonicalLinkTarget): string {
	if (target.parentResourceId) {
		return `/workspace/projects/${target.parentResourceId}/tasks/${target.resourceId}`;
	}
	return `/workspace/tasks/${target.resourceId}`;
}

function taskMobilePath(target: CanonicalLinkTarget): string {
	if (target.parentResourceId) {
		return `/(app)/(tasks)/${target.parentResourceId}/task/${target.resourceId}`;
	}
	return '/(app)/(tasks)';
}

function chatMobilePath(target: CanonicalLinkTarget): string {
	const params = new URLSearchParams();
	if (target.anchorType === 'message' && target.anchorId) {
		params.set('highlightedMessageId', target.anchorId);
	}
	const query = params.toString();
	const pathname = `/(app)/(chat)/${target.resourceId}`;
	return query ? `${pathname}?${query}` : pathname;
}

function threadMobilePath(target: CanonicalLinkTarget): string {
	const params = new URLSearchParams();
	if ((target.anchorType === 'message' || target.anchorType === 'thread') && target.anchorId) {
		params.set('highlightedMessageId', target.anchorId);
		const query = params.toString();
		return query
			? `/(app)/(chat)/thread/${target.anchorId}?${query}`
			: `/(app)/(chat)/thread/${target.anchorId}`;
	}
	return `/(app)/(chat)/thread/${target.resourceId}`;
}

function trimPath(pathname: string): string {
	return pathname.replace(/^\/+|\/+$/g, '');
}

function collectHtmlHrefCandidates(rawContent: string): string[] {
	const matches: string[] = [];
	hrefCandidatePattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = hrefCandidatePattern.exec(rawContent)) !== null) {
		const candidate = normalizeCandidateURL(match[2]);
		if (candidate) {
			matches.push(candidate);
		}
	}
	return matches;
}

function collectURLCandidates(rawContent: string): string[] {
	const matches: string[] = [];
	urlCandidatePattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = urlCandidatePattern.exec(rawContent)) !== null) {
		const candidate = normalizeCandidateURL(match[0]);
		if (candidate) {
			matches.push(candidate);
		}
	}
	return matches;
}

function normalizeCandidateURL(rawValue: string): string | null {
	const trimmed = decodeHtmlEntities(rawValue).trim().replace(/[),.;!?]+$/g, '');
	return trimmed.length > 0 ? trimmed : null;
}

function stripHtmlTags(value: string): string {
	return decodeHtmlEntities(value.replace(/<[^>]*>/g, ''));
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>');
}

function getContextValue(target: CanonicalLinkTarget, key: CanonicalContextKey): string | undefined {
	switch (key) {
		case 'focusIntent':
			return target.focusIntent;
		case 'entryContext':
			return target.entryContext;
		case 'requirementId':
			return target.requirementId;
		case 'anchorType':
			return target.anchorType;
		case 'anchorId':
			return target.anchorId;
	}
}

function setContextValue(target: CanonicalLinkTarget, key: CanonicalContextKey, value: string): void {
	switch (key) {
		case 'focusIntent':
			target.focusIntent = value;
			break;
		case 'entryContext':
			target.entryContext = value;
			break;
		case 'requirementId':
			target.requirementId = value;
			break;
		case 'anchorType':
			target.anchorType = value;
			break;
		case 'anchorId':
			target.anchorId = value;
			break;
	}
}

function isCanonicalResourceType(value: string): value is CanonicalResourceType {
	return (
		value === 'task' ||
		value === 'chat' ||
		value === 'thread' ||
		value === 'message' ||
		value === 'project' ||
		value === 'workspace' ||
		value === 'document' ||
		value === 'calendar' ||
		value === 'booking'
	);
}