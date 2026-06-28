/**
 * TypeScript interfaces for internal IAM authentication
 */

import type { IAMUser, OrganizationMembership, SSOIdentity } from 'apis';

/**
 * User profile with auth context for the workspace
 * Extends the base IAM user with organization context
 */
export interface UserProfile {
	/** User ID (UUID) */
	sub: string;
	/** Email address */
	email: string;
	/** Display name */
	name: string;
	/** Profile picture URL */
	picture?: string;
	/** Current organization ID (from JWT org_id claim) */
	organizationId?: string;
	/** Current organization name */
	organizationName?: string;
	/** Current organization membership ID (employee-derived) */
	membershipId?: string;
	/** User's role names in current organization */
	roleNames?: string[];
	/** Effective permission IDs in current organization */
	permissionIds: string[];
	/** All organization memberships */
	organizations: OrganizationMembership[];
	/** Linked SSO identities */
	ssoIdentities: SSOIdentity[];
	/** Whether user has password credential */
	hasPassword: boolean;
}

/**
 * Authentication state used in React components
 */
export interface AuthState {
	/** Whether the user is currently authenticated */
	isAuthenticated: boolean;
	/** User profile information (null if not authenticated) */
	user: UserProfile | null;
	/** Whether authentication state is being determined */
	isLoading: boolean;
	/** Authentication error message (null if no error) */
	error: string | null;
}

/**
 * Build a UserProfile from IAM API responses
 */
export function buildUserProfile(
	iamUser: IAMUser,
	organizations: OrganizationMembership[],
	ssoIdentities: SSOIdentity[],
	hasPassword: boolean,
	currentOrgId?: string,
): UserProfile {
	const currentOrg = currentOrgId
		? organizations.find(o => o.organizationId === currentOrgId)
		: organizations[0];

	return {
		sub: iamUser.id,
		email: iamUser.email,
		name: iamUser.displayName || iamUser.email,
		picture: iamUser.profilePictureUrl || undefined,
		organizationId: currentOrg?.organizationId,
		organizationName: currentOrg?.organizationName,
		membershipId: currentOrg?.id,
		roleNames: currentOrg?.roleNames,
		permissionIds: [],
		organizations,
		ssoIdentities,
		hasPassword,
	};
}
