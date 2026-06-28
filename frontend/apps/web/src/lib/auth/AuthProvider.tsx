/**
 * Authentication Context Provider
 * Provides auth state and methods to entire application using internal JWT
 */

'use client';

import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { configureRPC, hasAuthToken, getProfile, getEmployeePermissions, logout as apiLogout, switchOrganization as apiSwitchOrg } from 'apis';
import type { AuthState } from './types';
import { buildUserProfile } from './types';

interface AuthContextValue extends AuthState {
	logout: () => Promise<void>;
	switchOrganization: (orgId: string) => Promise<void>;
	refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadEffectivePermissions(membershipId?: string): Promise<string[]> {
	if (!membershipId) {
		return [];
	}

	try {
		return await getEmployeePermissions(membershipId);
	} catch {
		return [];
	}
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>({
		isAuthenticated: false,
		user: null,
		isLoading: true,
		error: null,
	});

	// Configure RPC base URL on client-side
	useEffect(() => {
		if (typeof window !== 'undefined') {
			configureRPC(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:18080');
		}
	}, []);

	const loadProfile = useCallback(async () => {
		if (!hasAuthToken()) {
			setState({ isAuthenticated: false, user: null, isLoading: false, error: null });
			return;
		}

		try {
			const profile = await getProfile();
			const userProfile = buildUserProfile(
				profile.user,
				profile.organizations,
				profile.ssoIdentities,
				profile.hasPassword,
			);
			const permissionIds = await loadEffectivePermissions(userProfile.membershipId);
			setState({
				isAuthenticated: true,
				user: { ...userProfile, permissionIds },
				isLoading: false,
				error: null,
			});
		} catch {
			setState({ isAuthenticated: false, user: null, isLoading: false, error: null });
		}
	}, []);

	// Load profile on mount if token exists
	useEffect(() => {
		loadProfile();
	}, [loadProfile]);

	const logout = useCallback(async () => {
		try {
			await apiLogout();
		} catch {
			// Clear token even if API call fails
		}
		setState({ isAuthenticated: false, user: null, isLoading: false, error: null });
	}, []);

	const switchOrganization = useCallback(async (orgId: string) => {
		const resp = await apiSwitchOrg(orgId);
		// Refresh profile to get updated org context
		const profile = await getProfile();
		const userProfile = buildUserProfile(
			profile.user,
			profile.organizations,
			profile.ssoIdentities,
			profile.hasPassword,
			orgId,
		);
		const permissionIds = await loadEffectivePermissions(userProfile.membershipId);
		setState(prev => ({
			...prev,
			user: { ...userProfile, roleNames: resp.roleNames, permissionIds },
		}));
	}, []);

	return (
		<AuthContext.Provider value={{
			...state,
			logout,
			switchOrganization,
			refreshProfile: loadProfile,
		}}>
			{children}
		</AuthContext.Provider>
	);
}

/**
 * Hook to access auth context
 */
export function useAuthContext(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error('useAuthContext must be used within AuthProvider');
	}
	return context;
}
