'use client';

import { getAuthToken } from 'apis';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
	canonicalTargetToWebFallbackPath,
	type CanonicalLinkResolution,
} from '@tech-office/links';

function buildIncomingUrl(origin: string, tenantKey: string, slug: string[], searchParams: URLSearchParams): string {
	const url = new URL(`/o/${tenantKey}/r/${slug.join('/')}`, origin);
	for (const [key, value] of searchParams.entries()) {
		url.searchParams.append(key, value);
	}
	return url.toString();
}

async function resolveCanonicalLink(inputUrl: string): Promise<CanonicalLinkResolution | null> {
	const token = await getAuthToken();
	const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/resolve`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({
			url: inputUrl,
			platform: 'web',
			isAuthenticated: false,
		}),
		cache: 'no-store',
	});
	if (!response.ok) {
		return null;
	}
	return (await response.json()) as CanonicalLinkResolution;
}

function StatusCard({
	title,
	description,
	primaryHref,
	primaryLabel,
	secondaryHref,
	secondaryLabel,
}: {
	title: string;
	description: string;
	primaryHref?: string | null;
	primaryLabel?: string;
	secondaryHref?: string | null;
	secondaryLabel?: string;
}) {
	return (
		<main style={{ padding: '3rem 1.5rem', maxWidth: 720, margin: '0 auto' }}>
			<div style={{ border: '1px solid #d9dde6', borderRadius: 16, padding: '2rem', background: '#fff' }}>
				<h1 style={{ marginTop: 0, marginBottom: '0.75rem' }}>{title}</h1>
				<p style={{ marginTop: 0, color: '#4f5b6b', lineHeight: 1.6 }}>{description}</p>
				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
					{primaryHref ? (
						<a href={primaryHref} style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#0f172a', color: '#fff', textDecoration: 'none' }}>
							{primaryLabel ?? 'Continue'}
						</a>
					) : null}
					{secondaryHref ? (
						<a href={secondaryHref} style={{ padding: '0.75rem 1rem', borderRadius: 10, border: '1px solid #c8d0dc', color: '#0f172a', textDecoration: 'none' }}>
							{secondaryLabel ?? 'Open workspace'}
						</a>
					) : null}
				</div>
			</div>
		</main>
	);
}

export default function CanonicalResourceResolverPage() {
	const router = useRouter();
	const params = useParams<{ tenantKey: string; slug: string[] | string }>();
	const searchParams = useSearchParams();
	const [resolution, setResolution] = useState<CanonicalLinkResolution | null | undefined>(undefined);

	const incomingUrl = useMemo(() => {
		if (typeof window === 'undefined') {
			return '';
		}
		const slug = Array.isArray(params.slug) ? params.slug : [params.slug];
		return buildIncomingUrl(window.location.origin, params.tenantKey, slug, new URLSearchParams(searchParams.toString()));
	}, [params.slug, params.tenantKey, searchParams]);

	useEffect(() => {
		if (!incomingUrl) {
			return;
		}
		let cancelled = false;

		async function run() {
			const payload = await resolveCanonicalLink(incomingUrl);
			if (cancelled) {
				return;
			}
			if (!payload) {
				setResolution(null);
				return;
			}
			if (payload.status === 'ok' && payload.webRoute) {
				router.replace(payload.webRoute);
				return;
			}
			if (payload.status === 'auth_required') {
				const incoming = new URL(incomingUrl);
				const redirectTarget = payload.webRoute || `${incoming.pathname}${incoming.search}`;
				router.replace(`/signin?redirect=${encodeURIComponent(redirectTarget)}`);
				return;
			}
			setResolution(payload);
		}

		void run();
		return () => {
			cancelled = true;
		};
	}, [incomingUrl, router]);

	if (resolution === undefined) {
		return <StatusCard title="Resolving link" description="Checking the destination and your access to this resource." />;
	}

	if (resolution === null) {
		return <StatusCard title="Link unavailable" description="This canonical link could not be resolved right now. Try again or return to the workspace." secondaryHref="/workspace" secondaryLabel="Go to workspace" />;
	}

	const fallbackHref = resolution.normalizedTarget ? canonicalTargetToWebFallbackPath(resolution.normalizedTarget) : null;
	if (resolution.status === 'access_denied') {
		return (
			<StatusCard
				title="Access denied"
				description="This link points to a resource that exists, but your current account cannot open it."
				secondaryHref={fallbackHref ?? '/workspace'}
				secondaryLabel="Go to workspace"
			/>
		);
	}

	if (resolution.status === 'not_found') {
		return (
			<StatusCard
				title="Resource not found"
				description="This link is valid, but the target resource is no longer available."
				secondaryHref={fallbackHref ?? '/workspace'}
				secondaryLabel="Go to workspace"
			/>
		);
	}

	return (
		<StatusCard
			title="Open a fallback destination"
			description="This link was recognized, but this browser route is not available. You can still continue from a safe fallback destination."
			primaryHref={fallbackHref}
			primaryLabel="Open fallback"
			secondaryHref={resolution.fallbackUrl ?? '/workspace'}
			secondaryLabel="Open canonical link"
		/>
	);
}