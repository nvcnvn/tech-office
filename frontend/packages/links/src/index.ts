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
	preview?: CanonicalLinkPreview;
}

export interface CanonicalLinkPreview {
	title: string;
	subtitle?: string;
	resourceType: CanonicalResourceType;
	href: string;
	badge?: string;
	thumbnail?: string;
}

export interface CanonicalPreviewResponse {
	preview?: CanonicalLinkPreview;
	normalizedTarget: CanonicalLinkTarget;
	status: CanonicalLinkResolution['status'];
	fallbackUrl?: string;
}

export interface CanonicalLinkTextSegment {
	kind: 'text' | 'link';
	value: string;
}

export interface CanonicalLinkPreviewDisplay {
	title: string;
	subtitle?: string;
	badge: string;
	href: string;
}

export interface SplitCanonicalLinkTextOptions {
	omitLinks?: boolean;
}

type CanonicalContextKey = (typeof allowedQueryKeys)[number];

const allowedQueryKeys = ['focusIntent', 'entryContext', 'requirementId', 'anchorType', 'anchorId'] as const;
const parentResourceTypes = new Set<CanonicalResourceType>(['project', 'workspace', 'chat', 'document', 'calendar', 'booking']);
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
	urlCandidatePattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = urlCandidatePattern.exec(rawText)) !== null) {
		const candidate = normalizeCandidateURL(match[0]);
		if (!candidate || !isCanonicalResourceLink(candidate)) {
			continue;
		}
		const start = match.index;
		const end = start + match[0].length;
		if (start > cursor) {
			segments.push({ kind: 'text', value: rawText.slice(cursor, start) });
		}
		if (!options.omitLinks) {
			segments.push({ kind: 'link', value: candidate });
		}
		cursor = end;
	}
	if (cursor < rawText.length) {
		segments.push({ kind: 'text', value: rawText.slice(cursor) });
	}
	return segments.length > 0 ? segments : [{ kind: 'text', value: rawText }];
}

export function removeCanonicalResourceLinksFromContent(rawContent: string): string {
	if (!rawContent) {
		return '';
	}

	const withoutCanonicalAnchors = rawContent.replace(anchorTagPattern, (_match, _quote: string, href: string, label: string) => {
		if (!isCanonicalResourceLink(href)) {
			return _match;
		}
		const strippedLabel = stripHtmlTags(label).trim();
		return strippedLabel && !isCanonicalResourceLink(strippedLabel) ? strippedLabel : '';
	});

	return splitTextByCanonicalResourceLinks(withoutCanonicalAnchors, { omitLinks: true })
		.map((segment) => segment.value)
		.join('')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function buildCanonicalLinkPreviewDisplay(preview: CanonicalLinkPreview): CanonicalLinkPreviewDisplay {
	return {
		title: preview.title,
		subtitle: preview.subtitle,
		badge: preview.badge || resourceTypeLabels[preview.resourceType],
		href: preview.href,
	};
}

export function describeCanonicalResourceLink(rawUrl: string): CanonicalLinkPreviewDisplay | null {
	const target = parseCanonicalResourceLink(rawUrl);
	if (!target) {
		return null;
	}

	const label = resourceTypeLabels[target.resourceType];
	const context = formatCanonicalContext(target);
	return {
		title: `${label} ${shortenIdentifier(target.resourceId)}`,
		subtitle: context || target.tenantKey,
		badge: label,
		href: normalizeCandidateURL(rawUrl) ?? rawUrl,
	};
}

export function getCanonicalLinkPreviewDisplay(preview: CanonicalLinkPreview | null | undefined, fallbackUrl?: string | null): CanonicalLinkPreviewDisplay | null {
	if (preview) {
		return buildCanonicalLinkPreviewDisplay(preview);
	}
	return fallbackUrl ? describeCanonicalResourceLink(fallbackUrl) : null;
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

function shortenIdentifier(value: string): string {
	if (value.length <= 12) {
		return value;
	}
	return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatCanonicalContext(target: CanonicalLinkTarget): string | undefined {
	const details = [target.focusIntent, target.anchorType, target.entryContext]
		.filter((value): value is string => Boolean(value))
		.map((value) => value.replace(/[_-]+/g, ' '));
	if (details.length === 0) {
		return undefined;
	}
	return details.join(' · ');
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