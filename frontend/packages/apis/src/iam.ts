/**
 * IAM (Identity and Access Management) API wrapper functions and types
 */

import { iamClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { AuthError, ValidationError } from "./errors";
import { iam } from "rpc";
import { setAuthToken, clearAuthToken } from "./token";
import { protoTimestampToDate } from "./proto-utils";

// ============================================================================
// Constants (cross-stack alignment)
// ============================================================================

export type IdentityRole = 'owner' | 'operator' | 'employee';


export type UserStatus = 'active' | 'suspended' | 'deleted';
export type SSOProviderType = 'google' | 'apple';

const invitationSSOEmailMismatchMessage = 'this sign-in used a different email than the one invited. continue with your invited email first, then link apple or google later';
export type InvitationStatusType = 'pending' | 'accepted' | 'cancelled' | 'expired';

// ============================================================================
// IAM Types
// ============================================================================

export interface IAMUser {
	id: string;
	email: string;
	displayName: string;
	profilePictureUrl: string;
	status: UserStatus;
	lastLoginAt?: Date;
	createdAt?: Date;
}

export interface SSOIdentity {
	id: string;
	provider: SSOProviderType;
	email: string;
	createdAt?: Date;
	lastUsedAt?: Date;
}

export interface OrganizationMembership {
	id: string;
	organizationId: string;
	organizationName: string;
	organizationSubdomain: string;
	roleNames: string[];
	joinedAt?: Date;
}

export interface IAMInvitation {
	id: string;
	email: string;
	roleId: string;
	roleName: string;
	status: InvitationStatusType;
	expiresAt?: Date;
	createdAt?: Date;
	invitedById: string;
	invitedByName: string;
}

export interface IAMSession {
	id: string;
	issuedAt?: Date;
	expiresAt?: Date;
	lastActivityAt?: Date;
	ipAddress: string;
	userAgent: string;
}

// ============================================================================
// Helper converters
// ============================================================================

function toSSOProvider(provider: SSOProviderType): iam.SSOProvider {
	switch (provider) {
		case 'google': return iam.SSOProvider.SSO_PROVIDER_GOOGLE;
		case 'apple': return iam.SSOProvider.SSO_PROVIDER_APPLE;
	}
}

function fromSSOProvider(p: iam.SSOProvider): SSOProviderType {
	switch (p) {
		case iam.SSOProvider.SSO_PROVIDER_GOOGLE: return 'google';
		case iam.SSOProvider.SSO_PROVIDER_APPLE: return 'apple';
		default: return 'google';
	}
}

function fromInvitationStatus(s: iam.InvitationStatus): InvitationStatusType {
	switch (s) {
		case iam.InvitationStatus.PENDING: return 'pending';
		case iam.InvitationStatus.ACCEPTED: return 'accepted';
		case iam.InvitationStatus.CANCELLED: return 'cancelled';
		case iam.InvitationStatus.EXPIRED: return 'expired';
		default: return 'pending';
	}
}

function toInvitationStatus(s: InvitationStatusType): iam.InvitationStatus {
	switch (s) {
		case 'pending': return iam.InvitationStatus.PENDING;
		case 'accepted': return iam.InvitationStatus.ACCEPTED;
		case 'cancelled': return iam.InvitationStatus.CANCELLED;
		case 'expired': return iam.InvitationStatus.EXPIRED;
	}
}

function fromUserStatus(s: iam.UserStatus): UserStatus {
	switch (s) {
		case iam.UserStatus.ACTIVE: return 'active';
		case iam.UserStatus.SUSPENDED: return 'suspended';
		case iam.UserStatus.DELETED: return 'deleted';
		default: return 'active';
	}
}

function userFromProto(u: iam.User): IAMUser {
	return {
		id: u.id,
		email: u.email,
		displayName: u.displayName,
		profilePictureUrl: u.profilePictureUrl,
		status: fromUserStatus(u.status),
		lastLoginAt: protoTimestampToDate(u.lastLoginAt),
		createdAt: protoTimestampToDate(u.createdAt),
	};
}

function ssoFromProto(s: iam.SSOIdentity): SSOIdentity {
	return {
		id: s.id,
		provider: fromSSOProvider(s.provider),
		email: s.email,
		createdAt: protoTimestampToDate(s.createdAt),
		lastUsedAt: protoTimestampToDate(s.lastUsedAt),
	};
}

function membershipFromProto(m: iam.OrganizationMembership): OrganizationMembership {
	return {
		id: m.id,
		organizationId: m.organizationId,
		organizationName: m.organizationName,
		organizationSubdomain: m.organizationSubdomain,
		roleNames: m.roleNames,
		joinedAt: protoTimestampToDate(m.joinedAt),
	};
}

function invitationFromProto(inv: iam.Invitation): IAMInvitation {
	return {
		id: inv.id,
		email: inv.email,
		roleId: inv.roleId,
		roleName: inv.roleName,
		status: fromInvitationStatus(inv.status),
		expiresAt: protoTimestampToDate(inv.expiresAt),
		createdAt: protoTimestampToDate(inv.createdAt),
		invitedById: inv.invitedById,
		invitedByName: inv.invitedByName,
	};
}

function sessionFromProto(s: iam.Session): IAMSession {
	return {
		id: s.id,
		issuedAt: protoTimestampToDate(s.issuedAt),
		expiresAt: protoTimestampToDate(s.expiresAt),
		lastActivityAt: protoTimestampToDate(s.lastActivityAt),
		ipAddress: s.ipAddress,
		userAgent: s.userAgent,
	};
}

// ============================================================================
// SSO Authentication
// ============================================================================

export async function exchangeToken(provider: SSOProviderType, idToken: string): Promise<{
	accessToken: string;
	expiresAt: number;
	user: IAMUser;
	isNewUser: boolean;
}> {
	return exchangeTokenForOrganization(provider, idToken);
}

export async function exchangeTokenForOrganization(
	provider: SSOProviderType,
	idToken: string,
	organizationId?: string,
): Promise<{
	accessToken: string;
	expiresAt: number;
	user: IAMUser;
	isNewUser: boolean;
}> {
	return rpcCall(async () => {
		const resp = await iamClient.exchangeToken({
			provider: toSSOProvider(provider),
			idToken,
			organizationId,
		});
		if (!resp.user) throw new AuthError('NO_USER', 'No user in response');
		await setAuthToken(resp.accessToken, Number(resp.expiresAt));
		return {
			accessToken: resp.accessToken,
			expiresAt: Number(resp.expiresAt),
			user: userFromProto(resp.user),
			isNewUser: resp.isNewUser,
		};
	});
}

// ============================================================================
// Password Authentication
// ============================================================================

export async function login(email: string, password: string, organizationId?: string): Promise<{
	accessToken: string;
	expiresAt: number;
	user: IAMUser;
}> {
	return rpcCall(async () => {
		const resp = await iamClient.login({ email, password, organizationId });
		if (!resp.user) throw new AuthError('NO_USER', 'No user in response');
		await setAuthToken(resp.accessToken, Number(resp.expiresAt));
		return {
			accessToken: resp.accessToken,
			expiresAt: Number(resp.expiresAt),
			user: userFromProto(resp.user),
		};
	});
}

// ============================================================================
// Password Management
// ============================================================================

export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.changePassword({ currentPassword, newPassword });
		await clearAuthToken();
		return resp.message;
	});
}

export async function requestPasswordReset(email: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.requestPasswordReset({ email });
		return resp.message;
	});
}

export async function resetPassword(token: string, newPassword: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.resetPassword({ token, newPassword });
		return resp.message;
	});
}

// ============================================================================
// Session Management
// ============================================================================

export async function logout(): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.logout({});
		await clearAuthToken();
		return resp.message;
	});
}

export async function logoutAllSessions(): Promise<number> {
	return rpcCall(async () => {
		const resp = await iamClient.logoutAllSessions({});
		await clearAuthToken();
		return resp.sessionsInvalidated;
	});
}

export async function getActiveSessions(): Promise<IAMSession[]> {
	return rpcCall(async () => {
		const resp = await iamClient.getActiveSessions({});
		return resp.sessions.map(sessionFromProto);
	});
}

// ============================================================================
// User Profile
// ============================================================================

export async function getProfile(): Promise<{
	user: IAMUser;
	ssoIdentities: SSOIdentity[];
	hasPassword: boolean;
	organizations: OrganizationMembership[];
}> {
	return rpcCall(async () => {
		const resp = await iamClient.getProfile({});
		if (!resp.user) throw new AuthError('NO_USER', 'No user in response');
		return {
			user: userFromProto(resp.user),
			ssoIdentities: resp.ssoIdentities.map(ssoFromProto),
			hasPassword: resp.hasPassword,
			organizations: resp.organizations.map(membershipFromProto),
		};
	});
}

export async function updateProfile(displayName?: string, profilePictureUrl?: string): Promise<IAMUser> {
	return rpcCall(async () => {
		const resp = await iamClient.updateProfile({ displayName, profilePictureUrl });
		if (!resp.user) throw new AuthError('NO_USER', 'No user in response');
		return userFromProto(resp.user);
	});
}

// ============================================================================
// SSO Identity Management
// ============================================================================

export async function linkSSOIdentity(provider: SSOProviderType, idToken: string): Promise<SSOIdentity> {
	return rpcCall(async () => {
		const resp = await iamClient.linkSSOIdentity({
			provider: toSSOProvider(provider),
			idToken,
		});
		if (!resp.ssoIdentity) throw new AuthError('NO_SSO', 'No SSO identity in response');
		return ssoFromProto(resp.ssoIdentity);
	});
}

export async function unlinkSSOIdentity(ssoIdentityId: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.unlinkSSOIdentity({ ssoIdentityId });
		return resp.message;
	});
}

// ============================================================================
// Organization Membership
// ============================================================================

export async function getUserOrganizations(): Promise<OrganizationMembership[]> {
	return rpcCall(async () => {
		const resp = await iamClient.getUserOrganizations({});
		return resp.organizations.map(membershipFromProto);
	});
}

export async function switchOrganization(organizationId: string): Promise<{
	accessToken: string;
	expiresAt: number;
	roleNames: string[];
}> {
	return rpcCall(async () => {
		const resp = await iamClient.switchOrganization({ organizationId });
		await setAuthToken(resp.accessToken, Number(resp.expiresAt));
		return {
			accessToken: resp.accessToken,
			expiresAt: Number(resp.expiresAt),
			roleNames: resp.roleNames,
		};
	});
}

// ============================================================================
// Invitations
// ============================================================================

export async function inviteUser(organizationId: string, email: string, roleId: string): Promise<IAMInvitation> {
	return rpcCall(async () => {
		const resp = await iamClient.inviteUser({
			organizationId,
			email,
			roleId,
		});
		if (!resp.invitation) throw new AuthError('NO_INVITATION', 'No invitation in response');
		return invitationFromProto(resp.invitation);
	});
}

export async function cancelInvitation(organizationId: string, invitationId: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.cancelInvitation({ organizationId, invitationId });
		return resp.message;
	});
}

export async function listInvitations(organizationId: string, status?: InvitationStatusType): Promise<IAMInvitation[]> {
	return rpcCall(async () => {
		const resp = await iamClient.listInvitations({
			organizationId,
			status: status ? toInvitationStatus(status) : undefined,
		});
		return resp.invitations.map(invitationFromProto);
	});
}

export async function acceptInvitation(
	token: string,
	options?: {
		displayName?: string;
		ssoProvider?: SSOProviderType;
		ssoIdToken?: string;
		password?: string;
	}
): Promise<{
	accessToken: string;
	expiresAt: number;
	user: IAMUser;
	membership: OrganizationMembership;
}> {
	try {
		return await rpcCall(async () => {
			const resp = await iamClient.acceptInvitation({
				token,
				displayName: options?.displayName,
				ssoProvider: options?.ssoProvider ? toSSOProvider(options.ssoProvider) : undefined,
				ssoIdToken: options?.ssoIdToken,
				password: options?.password,
			});
			if (!resp.user) throw new AuthError('NO_USER', 'No user in response');
			if (!resp.membership) throw new AuthError('NO_MEMBERSHIP', 'No membership in response');
			await setAuthToken(resp.accessToken, Number(resp.expiresAt));
			return {
				accessToken: resp.accessToken,
				expiresAt: Number(resp.expiresAt),
				user: userFromProto(resp.user),
				membership: membershipFromProto(resp.membership),
			};
		});
	} catch (err) {
		if (
			err instanceof ValidationError &&
			err.message.trim().toLowerCase() === invitationSSOEmailMismatchMessage
		) {
			throw new AuthError(
				'INVITATION_SSO_EMAIL_MISMATCH',
				'This sign-in used a different email than the one invited. Continue with your invited email first, then link Apple or Google later.',
			);
		}
		throw err;
	}
}

// ============================================================================
// Permissions & Roles
// ============================================================================

export interface IAMPermission {
	id: string;
	domain: string;
	description: string;
}

export interface IAMPermissionGroup {
	domain: string;
	permissions: IAMPermission[];
}

export interface IAMOrgRole {
	id: string;
	name: string;
	description: string;
	isSystem: boolean;
	permissionIds: string[];
	employeeCount: number;
}

function orgRoleFromProto(r: iam.OrgRole): IAMOrgRole {
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		isSystem: r.isSystem,
		permissionIds: r.permissionIds,
		employeeCount: r.employeeCount,
	};
}

function permissionGroupFromProto(g: iam.PermissionGroup): IAMPermissionGroup {
	return {
		domain: g.domain,
		permissions: g.permissions.map(p => ({
			id: p.id,
			domain: p.domain,
			description: p.description,
		})),
	};
}

export async function listPermissions(domain?: string): Promise<{
	groups: IAMPermissionGroup[];
	totalCount: number;
}> {
	return rpcCall(async () => {
		const resp = await iamClient.listPermissions({ domain });
		return {
			groups: resp.groups.map(permissionGroupFromProto),
			totalCount: resp.totalCount,
		};
	});
}

export async function createRole(name: string, description: string, permissionIds: string[]): Promise<IAMOrgRole> {
	return rpcCall(async () => {
		const resp = await iamClient.createRole({ name, description, permissionIds });
		if (!resp.role) throw new AuthError('NO_ROLE', 'No role in response');
		return orgRoleFromProto(resp.role);
	});
}

export async function updateRole(roleId: string, name?: string, description?: string, permissionIds?: string[]): Promise<IAMOrgRole> {
	return rpcCall(async () => {
		const resp = await iamClient.updateRole({
			roleId,
			name,
			description,
			permissionIds: permissionIds ?? [],
			updatePermissions: permissionIds !== undefined,
		});
		if (!resp.role) throw new AuthError('NO_ROLE', 'No role in response');
		return orgRoleFromProto(resp.role);
	});
}

export async function deleteRole(roleId: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.deleteRole({ roleId });
		return resp.message;
	});
}

export async function listRoles(): Promise<IAMOrgRole[]> {
	return rpcCall(async () => {
		const resp = await iamClient.listRoles({});
		return resp.roles.map(orgRoleFromProto);
	});
}

export async function getRole(roleId: string): Promise<IAMOrgRole> {
	return rpcCall(async () => {
		const resp = await iamClient.getRole({ roleId });
		if (!resp.role) throw new AuthError('NO_ROLE', 'No role in response');
		return orgRoleFromProto(resp.role);
	});
}

export async function assignRole(employeeId: string, roleId: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.assignRole({ employeeId, roleId });
		return resp.message;
	});
}

export async function revokeRole(employeeId: string, roleId: string): Promise<string> {
	return rpcCall(async () => {
		const resp = await iamClient.revokeRole({ employeeId, roleId });
		return resp.message;
	});
}

export async function listEmployeeRoles(employeeId: string): Promise<IAMOrgRole[]> {
	return rpcCall(async () => {
		const resp = await iamClient.listEmployeeRoles({ employeeId });
		return resp.roles.map(orgRoleFromProto);
	});
}

export async function getEmployeePermissions(employeeId: string): Promise<string[]> {
	return rpcCall(async () => {
		const resp = await iamClient.getEmployeePermissions({ employeeId });
		return resp.permissionIds;
	});
}
