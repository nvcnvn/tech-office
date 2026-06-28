/**
 * Authentication React hooks
 * Provides convenient hooks for accessing auth state in components
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from './AuthProvider';
import type { AuthState } from './types';

/**
 * Hook to access authentication state
 */
export function useAuthState(): AuthState {
	const { isAuthenticated, user, isLoading, error } = useAuthContext();
	return { isAuthenticated, user, isLoading, error };
}

/**
 * Hook to enforce authentication requirement
 * Redirects to signin page if user is not authenticated
 */
export function useRequireAuth(): AuthState {
	const router = useRouter();
	const authState = useAuthState();

	useEffect(() => {
		if (authState.isLoading) return;

		if (!authState.isAuthenticated && typeof window !== 'undefined') {
			const currentPath = window.location.pathname + window.location.search;
			const signinUrl = `/signin?redirect=${encodeURIComponent(currentPath)}`;
			router.push(signinUrl);
		}
	}, [authState.isAuthenticated, authState.isLoading, router]);

	return authState;
}

/**
 * Hook to access auth methods (logout, switchOrganization, refreshProfile)
 */
export function useAuth() {
	const { logout, switchOrganization, refreshProfile } = useAuthContext();
	return { logout, switchOrganization, refreshProfile };
}
