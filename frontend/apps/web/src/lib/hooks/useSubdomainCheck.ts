'use client';

import { useState, useEffect } from 'react';
import { checkSubdomainAvailable } from 'apis';

interface UseSubdomainCheckResult {
	isChecking: boolean;
	isAvailable: boolean | null;
	/** The next free variant when the address is taken, otherwise null. */
	suggested: string | null;
	error: Error | null;
}

/**
 * Hook for debounced subdomain availability checking
 * @param subdomain - Subdomain to check
 * @param debounceMs - Debounce delay in milliseconds (default: 500)
 * @returns Availability check state
 */
export function useSubdomainCheck(
	subdomain: string,
	debounceMs: number = 500
): UseSubdomainCheckResult {
	const [isChecking, setIsChecking] = useState(false);
	const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
	const [suggested, setSuggested] = useState<string | null>(null);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		// Reset state if subdomain is empty or too short
		if (!subdomain || subdomain.length < 3) {
			setIsAvailable(null);
			setSuggested(null);
			setError(null);
			setIsChecking(false);
			return;
		}

		// Debounce the API call
		const timeoutId = setTimeout(async () => {
			setIsChecking(true);
			setError(null);

			try {
				const result = await checkSubdomainAvailable(subdomain);
				setIsAvailable(result.available);
				setSuggested(result.suggested || null);
			} catch (err) {
				setError(err instanceof Error ? err : new Error('Failed to check subdomain'));
				setIsAvailable(null);
				setSuggested(null);
			} finally {
				setIsChecking(false);
			}
		}, debounceMs);

		// Cleanup timeout on subdomain change
		return () => clearTimeout(timeoutId);
	}, [subdomain, debounceMs]);

	return { isChecking, isAvailable, suggested, error };
}
