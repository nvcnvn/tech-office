import {
	canonicalTargetToMobileFallbackPath,
	canonicalTargetToMobilePath,
	isCanonicalResourceLink,
	parseCanonicalResourceLink,
	type CanonicalLinkResolution,
	type CanonicalPreviewResponse,
} from '@tech-office/links';
import { getAuthToken } from 'apis';

import { setPendingPostSignInRedirect } from '@/lib/auth-redirect-handoff';
import { API_BASE_URL, buildWebUrl } from '@/lib/constants';

function normalizeResolvedMobileRoute(route: string): string {
	const [pathname, rawQuery = ''] = route.split('?', 2);
	const params = new URLSearchParams(rawQuery);
	const anchorType = params.get('anchorType');
	const anchorId = params.get('anchorId');

	if (pathname.startsWith('/(app)/(chat)/thread/')) {
		if ((anchorType === 'message' || anchorType === 'thread') && anchorId) {
			params.delete('anchorType');
			params.delete('anchorId');
			params.set('highlightedMessageId', anchorId);
			const query = params.toString();
			return query ? `/(app)/(chat)/thread/${anchorId}?${query}` : `/(app)/(chat)/thread/${anchorId}`;
		}
		return route;
	}

	if (pathname.startsWith('/(app)/(chat)/') && anchorType === 'message' && anchorId) {
		params.delete('anchorType');
		params.delete('anchorId');
		params.set('highlightedMessageId', anchorId);
		const query = params.toString();
		return query ? `${pathname}?${query}` : pathname;
	}

	return route;
}

function routeWithCanonicalAnchorContext(route: string, target?: CanonicalLinkResolution['normalizedTarget'] | null): string {
	if (!target?.anchorType || !target.anchorId) {
		return route;
	}

	const [pathname, rawQuery = ''] = route.split('?', 2);
	const params = new URLSearchParams(rawQuery);
	if (!params.has('anchorType')) {
		params.set('anchorType', target.anchorType);
	}
	if (!params.has('anchorId')) {
		params.set('anchorId', target.anchorId);
	}

	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

function buildLinkStatusRoute(
	status: CanonicalLinkResolution['status'],
	fallbackPath?: string | null,
	browserUrl?: string | null,
): string {
	const params = new URLSearchParams({ status });
	if (fallbackPath) {
		params.set('fallback', fallbackPath);
	}
	if (browserUrl) {
		params.set('browserUrl', browserUrl);
	}
	return `/link-status?${params.toString()}`;
}

interface CanonicalInAppRouteOptions {
	preferRecoverableFallback?: boolean;
	authToken?: string | null;
}

function buildAuthRedirectRoute(
	target: NonNullable<ReturnType<typeof parseCanonicalResourceLink>>,
	redirectPath: string,
): string {
	const redirect = routeWithCanonicalAnchorContext(redirectPath, target);
	setPendingPostSignInRedirect(redirect, target.tenantKey);
	return '/link-handoff';
}

export async function resolveCanonicalMobileRoute(raw: string, authToken?: string | null): Promise<CanonicalLinkResolution | null> {
	try {
		const token = authToken ?? await getAuthToken();
		const response = await fetch(`${API_BASE_URL}/api/linking/resolve`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({
				url: raw,
				platform: 'mobile',
				isAuthenticated: Boolean(token),
			}),
		});
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as CanonicalLinkResolution;
	} catch {
		return null;
	}
}

export async function fetchCanonicalPreview(raw: string): Promise<CanonicalPreviewResponse | null> {
	try {
		const token = await getAuthToken();
		const response = await fetch(`${API_BASE_URL}/api/linking/preview?url=${encodeURIComponent(raw)}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		});
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as CanonicalPreviewResponse;
	} catch {
		return null;
	}
}

export async function getCanonicalInAppRoute(
	pathOrURL: string,
	options?: CanonicalInAppRouteOptions,
): Promise<string | null> {
	if (!pathOrURL) {
		return null;
	}
	const raw = pathOrURL.startsWith('http')
		? pathOrURL
		: buildWebUrl(pathOrURL);
	if (!isCanonicalResourceLink(raw)) {
		return null;
	}
	const target = parseCanonicalResourceLink(raw);
	if (!target) {
		return null;
	}
	const fallbackPath = canonicalTargetToMobileFallbackPath(target) ?? canonicalTargetToMobilePath(target) ?? '/(app)';
	const token = options?.authToken ?? await getAuthToken();
	if (!token) {
		return buildAuthRedirectRoute(target, raw);
	}

	const resolution = await resolveCanonicalMobileRoute(raw, token);
	if (!resolution) {
		return fallbackPath;
	}
	if (resolution.status === 'ok' && resolution.mobileRoute) {
		return normalizeResolvedMobileRoute(
			routeWithCanonicalAnchorContext(
				resolution.mobileRoute,
				resolution.normalizedTarget?.anchorId ? resolution.normalizedTarget : target,
			),
		);
	}
	if (resolution.status === 'auth_required') {
		return buildAuthRedirectRoute(
			resolution.normalizedTarget?.anchorId ? resolution.normalizedTarget : target,
			resolution.mobileRoute ?? fallbackPath,
		);
	}
	if (resolution.status === 'not_found' || resolution.status === 'fallback') {
		if (options?.preferRecoverableFallback) {
			return fallbackPath;
		}
		return buildLinkStatusRoute(resolution.status, fallbackPath, resolution.fallbackUrl ?? raw);
	}
	if (resolution.status === 'access_denied') {
		return buildLinkStatusRoute(resolution.status, fallbackPath, resolution.fallbackUrl ?? raw);
	}
	return fallbackPath;
}

export async function generateCanonicalUrl(
	tenantKey: string,
	resourceType: string,
	resourceId: string,
): Promise<string | null> {
	try {
		const token = await getAuthToken();
		const response = await fetch(`${API_BASE_URL}/api/linking/generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({
				target: { tenantKey, resourceType, resourceId },
			}),
		});
		if (!response.ok) return null;
		const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
		return payload?.canonicalUrl ?? null;
	} catch {
		return null;
	}
}