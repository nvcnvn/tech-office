/**
 * OAuth Callback Handler (Legacy)
 * This page is kept for backward compatibility.
 * With internal JWT auth, SSO token exchange happens client-side.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CallbackPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace('/signin');
	}, [router]);

	return null;
}
