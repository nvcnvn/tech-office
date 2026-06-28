import {
	isCanonicalResourceLink,
	parseCanonicalResourceLink,
} from '@tech-office/links';

import { getCanonicalInAppRoute } from '@/lib/canonical-links';
import { buildWebUrl } from '@/lib/constants';
import { setPendingPostSignInRedirect } from '@/lib/auth-redirect-handoff';
import { toSharedResourceHref, withNavigationContext } from '@/lib/mobile-navigation';

function toNativeRedirectPath(href: string): string {
	const [pathname, rawQuery = ''] = href.split('?', 2);
	const path = pathname
		.split('/')
		.filter((segment) => segment && !/^\(.+\)$/.test(segment))
		.join('/');
	const query = rawQuery ? `?${rawQuery}` : '';
	return `/${path}${query}`;
}

function decodeHexPayload(encoded: string): string | null {
	if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
		return null;
	}

	let decoded = '';
	for (let index = 0; index < encoded.length; index += 2) {
		decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16));
	}
	return decoded;
}

function decodeCanonicalLinkPath(appPath: string): string | null {
	const [pathname] = appPath.split('?', 2);
	const segments = pathname.split('/').filter(Boolean);
	if (segments[0] !== 'canonical-link') {
		return null;
	}
	return decodeHexPayload(segments[1] ?? '');
}

function finalizeResolvedPath(resolved: string): string {
	if (resolved.startsWith('/canonical-signin') || resolved.startsWith('/link-handoff') || resolved.startsWith('/(auth)') || resolved.startsWith('/link-status')) {
		return toNativeRedirectPath(resolved);
	}
	const contextualHref = withNavigationContext(resolved);
	return toNativeRedirectPath(toSharedResourceHref(contextualHref));
}

interface NormalizedSystemPath {
	appPath: string;
	canonicalUrl: string;
}

function normalizeSystemPath(rawPath: string): NormalizedSystemPath {
	try {
		const url = new URL(rawPath);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			const pathname = url.pathname && url.pathname !== '/' ? url.pathname : `/${url.hostname}`;
			const appPath = `${pathname}${url.search}`;
			return {
				appPath,
				canonicalUrl: buildWebUrl(appPath),
			};
		}
		return {
			appPath: `${url.pathname}${url.search}`,
			canonicalUrl: url.toString(),
		};
	} catch {
		// Fall back to treating the value as a path below.
	}

	const appPath = `${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
	return {
		appPath,
		canonicalUrl: buildWebUrl(appPath),
	};
}

function buildCanonicalHandoffPath(raw: string): string | null {
	const target = parseCanonicalResourceLink(raw);
	if (!target) {
		return null;
	}

	setPendingPostSignInRedirect(raw, target.tenantKey);
	return '/canonical-signin';
}

export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): Promise<string> {
	if (!path) {
		return '/';
	}
	const { appPath, canonicalUrl: raw } = normalizeSystemPath(path);
	const decodedCanonicalLink = decodeCanonicalLinkPath(appPath);
	if (decodedCanonicalLink && isCanonicalResourceLink(decodedCanonicalLink)) {
		const resolved = (await getCanonicalInAppRoute(decodedCanonicalLink)) ?? appPath;
		return finalizeResolvedPath(resolved);
	}
	if (!isCanonicalResourceLink(raw)) {
		return appPath;
	}
	if (initial || path.startsWith('techoffice:') || appPath.startsWith('/o/')) {
		return buildCanonicalHandoffPath(raw) ?? '/signin';
	}
	const resolved = (await getCanonicalInAppRoute(raw)) ?? path;
	return finalizeResolvedPath(resolved);
}

export default function NativeIntent() {
	return null;
}