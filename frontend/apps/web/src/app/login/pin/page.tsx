'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Container, CircularProgress } from '@mui/material';

function PINLoginRedirect() {
	const router = useRouter();
	const searchParams = useSearchParams();

	useEffect(() => {
		const org = searchParams.get('org');
		const redirect = searchParams.get('redirect');
		const params = new URLSearchParams();
		if (org) params.set('org', org);
		if (redirect) params.set('redirect', redirect);
		const qs = params.toString();
		router.replace(`/signin${qs ? `?${qs}` : ''}`);
	}, [router, searchParams]);

	return (
		<Container maxWidth="sm">
			<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<CircularProgress />
			</Box>
		</Container>
	);
}

/**
 * Legacy PIN login page — redirects to the unified /signin page.
 * Preserves ?org= query param if present so the org selector is pre-filled.
 */
export default function PINLoginPage() {
	return (
		<Suspense
			fallback={
				<Container maxWidth="sm">
					<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
						<CircularProgress />
					</Box>
				</Container>
			}
		>
			<PINLoginRedirect />
		</Suspense>
	);
}
