'use client';

import React, { useState } from 'react';
import { Box, Container, Paper, Typography, Tabs, Tab, TextField, Button, Alert, CircularProgress, List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { Delete as DeleteIcon, Logout as LogoutIcon } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import { useRequireAuth, useAuth } from '@/lib/auth/hooks';
import AvatarUpload from './components/AvatarUpload';
import { updateProfile, changePassword, getActiveSessions, logoutAllSessions, unlinkSSOIdentity, inviteUser, cancelInvitation, listInvitations, listRoles } from 'apis';
import type { IAMSession, IAMInvitation, IAMOrgRole } from 'apis';

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
	if (value !== index) return null;
	return <Box sx={{ py: 3 }}>{children}</Box>;
}

export default function ProfilePage() {
	const authState = useRequireAuth();
	const { refreshProfile, switchOrganization, logout } = useAuth();
	const colors = useThemeColors();
	const [tab, setTab] = useState(0);

	if (!authState.user) return null;

	return (
		<Container maxWidth="md" sx={{ py: 4 }}>
			<Typography variant="h4" gutterBottom sx={colors.text.primary.style}>
				Profile & Settings
			</Typography>

			<Paper sx={{ ...colors.bg.paper.style }}>
				<Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }} data-testid="profile-tabs">
					<Tab label="Profile" data-testid="profile-tab" />
					<Tab label="Security" data-testid="security-tab" />
					<Tab label="Sessions" data-testid="sessions-tab" />
					<Tab label="Organizations" data-testid="organizations-tab" />
				</Tabs>

				<Box sx={{ p: 3 }}>
					<TabPanel value={tab} index={0}>
						<ProfileTab user={authState.user} colors={colors} onRefresh={refreshProfile} />
					</TabPanel>
					<TabPanel value={tab} index={1}>
						<SecurityTab user={authState.user} onLogout={logout} />
					</TabPanel>
					<TabPanel value={tab} index={2}>
						<SessionsTab />
					</TabPanel>
					<TabPanel value={tab} index={3}>
						<OrganizationsTab user={authState.user} onSwitch={switchOrganization} />
					</TabPanel>
				</Box>
			</Paper>
		</Container>
	);
}

// ============================================================================
// Profile Tab
// ============================================================================

function ProfileTab({ user, colors, onRefresh }: { user: NonNullable<ReturnType<typeof useRequireAuth>['user']>; colors: ReturnType<typeof useThemeColors>; onRefresh: () => Promise<void> }) {
	const [displayName, setDisplayName] = useState(user.name);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	const handleSave = async () => {
		setSaving(true);
		setMessage(null);
		try {
			await updateProfile(displayName);
			await onRefresh();
			setMessage({ type: 'success', text: 'Profile updated' });
		} catch (err) {
			setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Update failed' });
		} finally {
			setSaving(false);
		}
	};

	const handleAvatarUploadComplete = async (_fileId: string, downloadUrl: string) => {
		try {
			await updateProfile(undefined, downloadUrl);
			await onRefresh();
		} catch (err) {
			console.error('Failed to update avatar:', err);
		}
	};

	return (
		<>
			<AvatarUpload
				currentAvatarUrl={user.picture}
				employeeName={user.name}
				onUploadComplete={handleAvatarUploadComplete}
				onUploadError={(err) => setMessage({ type: 'error', text: err.message })}
			/>

			<Box sx={{ mt: 4, maxWidth: 400 }}>
				<TextField
					fullWidth
					label="Display Name"
					value={displayName}
					onChange={(e) => setDisplayName(e.target.value)}
					sx={{ mb: 2 }}
					inputProps={{ 'data-testid': 'display-name-input' }}
				/>
				<TextField
					fullWidth
					label="Email"
					value={user.email}
					disabled
					sx={{ mb: 2 }}
				/>
				<Button variant="contained" onClick={handleSave} disabled={saving} data-testid="save-profile-button">
					{saving ? <CircularProgress size={20} /> : 'Save Changes'}
				</Button>
				{message && <Alert severity={message.type} sx={{ mt: 2 }}>{message.text}</Alert>}
			</Box>

			{/* SSO Identities */}
			{user.ssoIdentities.length > 0 && (
				<Box sx={{ mt: 4 }}>
					<Typography variant="h6" gutterBottom sx={colors.text.primary.style}>
						Linked SSO Accounts
					</Typography>
					<List>
						{user.ssoIdentities.map(sso => (
							<ListItem key={sso.id}>
								<ListItemText
									primary={`${sso.provider.charAt(0).toUpperCase() + sso.provider.slice(1)} — ${sso.email}`}
									secondary={sso.lastUsedAt ? `Last used: ${sso.lastUsedAt.toLocaleDateString()}` : undefined}
								/>
								<ListItemSecondaryAction>
									<IconButton
										edge="end"
										onClick={async () => {
											try {
												await unlinkSSOIdentity(sso.id);
												await onRefresh();
											} catch (err) {
												setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to unlink' });
											}
										}}
									>
										<DeleteIcon />
									</IconButton>
								</ListItemSecondaryAction>
							</ListItem>
						))}
					</List>
				</Box>
			)}
		</>
	);
}

// ============================================================================
// Security Tab
// ============================================================================

function SecurityTab({ user, onLogout }: { user: NonNullable<ReturnType<typeof useRequireAuth>['user']>; onLogout: () => Promise<void> }) {
	const [currentPw, setCurrentPw] = useState('');
	const [newPw, setNewPw] = useState('');
	const [confirmPw, setConfirmPw] = useState('');
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		if (newPw.length < 8) {
			setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
			return;
		}
		if (newPw !== confirmPw) {
			setMessage({ type: 'error', text: 'Passwords do not match' });
			return;
		}

		setSaving(true);
		setMessage(null);
		try {
			await changePassword(currentPw, newPw);
			setMessage({ type: 'success', text: 'Password changed. Please sign in again.' });
			setCurrentPw('');
			setNewPw('');
			setConfirmPw('');
			// Token was invalidated on password change — log out after brief delay
			setTimeout(() => onLogout(), 2000);
		} catch (err) {
			setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Box component="form" onSubmit={handleChangePassword} sx={{ maxWidth: 400 }}>
			<Typography variant="h6" gutterBottom>
				{user.hasPassword ? 'Change Password' : 'Set Password'}
			</Typography>

			{user.hasPassword && (
				<TextField
					fullWidth
					label="Current Password"
					type="password"
					value={currentPw}
					onChange={(e) => setCurrentPw(e.target.value)}
					sx={{ mb: 2 }}
					autoComplete="current-password"
				/>
			)}

			<TextField
				fullWidth
				label="New Password"
				type="password"
				value={newPw}
				onChange={(e) => setNewPw(e.target.value)}
				sx={{ mb: 2 }}
				autoComplete="new-password"
			/>
			<TextField
				fullWidth
				label="Confirm New Password"
				type="password"
				value={confirmPw}
				onChange={(e) => setConfirmPw(e.target.value)}
				sx={{ mb: 3 }}
				autoComplete="new-password"
			/>

			<Button type="submit" variant="contained" disabled={saving}>
				{saving ? <CircularProgress size={20} /> : user.hasPassword ? 'Change Password' : 'Set Password'}
			</Button>

			{message && <Alert severity={message.type} sx={{ mt: 2 }}>{message.text}</Alert>}
		</Box>
	);
}

// ============================================================================
// Sessions Tab
// ============================================================================

function SessionsTab() {
	const [sessions, setSessions] = useState<IAMSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	React.useEffect(() => {
		getActiveSessions()
			.then(setSessions)
			.catch(err => setError(err instanceof Error ? err.message : 'Failed to load sessions'))
			.finally(() => setLoading(false));
	}, []);

	const handleLogoutAll = async () => {
		try {
			await logoutAllSessions();
			setSessions([]);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to log out all sessions');
		}
	};

	if (loading) return <CircularProgress />;
	if (error) return <Alert severity="error">{error}</Alert>;

	return (
		<>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
				<Typography variant="h6">Active Sessions</Typography>
				{sessions.length > 1 && (
					<Button
						variant="outlined"
						color="error"
						startIcon={<LogoutIcon />}
						onClick={handleLogoutAll}
						size="small"
					>
						Log out all
					</Button>
				)}
			</Box>

			{sessions.length === 0 ? (
				<Typography color="text.secondary">No active sessions</Typography>
			) : (
				<List>
					{sessions.map(s => (
						<ListItem key={s.id} divider>
							<ListItemText
								primary={s.userAgent || 'Unknown device'}
								secondary={
									<>
										{s.ipAddress && <>IP: {s.ipAddress} &bull; </>}
										{s.issuedAt && <>Created: {s.issuedAt.toLocaleString()}</>}
									</>
								}
							/>
						</ListItem>
					))}
				</List>
			)}
		</>
	);
}

// ============================================================================
// Organizations Tab
// ============================================================================

function OrganizationsTab({ user, onSwitch }: { user: NonNullable<ReturnType<typeof useRequireAuth>['user']>; onSwitch: (orgId: string) => Promise<void> }) {
	const orgs = user.organizations;
	const [invitations, setInvitations] = useState<IAMInvitation[]>([]);
	const [availableRoles, setAvailableRoles] = useState<IAMOrgRole[]>([]);
	const [showInvite, setShowInvite] = useState(false);
	const [inviteEmail, setInviteEmail] = useState('');
	const [inviteRoleId, setInviteRoleId] = useState('');
	const [inviting, setInviting] = useState(false);
	const [loadingRoles, setLoadingRoles] = useState(false);
	const [error, setError] = useState('');
	const [switching, setSwitching] = useState<string | null>(null);

	const currentOrgId = user.organizationId;
	const permissionSet = new Set(user.permissionIds);
	const canViewInvitations = permissionSet.has('iam.listInvitations');
	const canInviteUsers = permissionSet.has('iam.inviteUser');
	const canCancelInvitations = permissionSet.has('iam.cancelInvitation');
	const canViewRoles = permissionSet.has('iam.viewRoles');
	const canManageOrganizationAccess = canViewInvitations || canInviteUsers || canCancelInvitations || canViewRoles;

	React.useEffect(() => {
		if (!currentOrgId || !canManageOrganizationAccess) {
			setInvitations([]);
			setAvailableRoles([]);
			return;
		}

		let cancelled = false;

		const loadInvitationContext = async () => {
			setLoadingRoles(true);
			try {
				const [pendingInvitationsResult, rolesResult] = await Promise.allSettled([
					canViewInvitations ? listInvitations(currentOrgId, 'pending') : Promise.resolve([]),
					canViewRoles ? listRoles() : Promise.resolve([]),
				]);

				if (cancelled) {
					return;
				}

				const pendingInvitations = pendingInvitationsResult.status === 'fulfilled' ? pendingInvitationsResult.value : [];
				const roles = rolesResult.status === 'fulfilled' ? rolesResult.value : [];

				setInvitations(pendingInvitations);
				setAvailableRoles(roles);
				setInviteRoleId((currentValue) => {
					if (roles.some((role) => role.id === currentValue)) {
						return currentValue;
					}

					return roles.find((role) => role.name === 'Employee')?.id ?? roles[0]?.id ?? '';
				});
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Failed to load role options');
				}
			} finally {
				if (!cancelled) {
					setLoadingRoles(false);
				}
			}
		};

		loadInvitationContext();

		return () => {
			cancelled = true;
		};
	}, [canManageOrganizationAccess, canViewInvitations, canViewRoles, currentOrgId]);

	const handleSwitch = async (orgId: string) => {
		setSwitching(orgId);
		try {
			await onSwitch(orgId);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to switch organization');
		} finally {
			setSwitching(null);
		}
	};

	const handleInvite = async () => {
		if (!currentOrgId || !canInviteUsers || !inviteEmail || !inviteRoleId) return;
		setInviting(true);
		try {
			const inv = await inviteUser(currentOrgId, inviteEmail, inviteRoleId);
			setInvitations(prev => [...prev, inv]);
			setInviteEmail('');
			setShowInvite(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to invite user');
		} finally {
			setInviting(false);
		}
	};

	const handleCancelInvitation = async (invitationId: string) => {
		if (!currentOrgId || !canCancelInvitations) return;
		try {
			await cancelInvitation(currentOrgId, invitationId);
			setInvitations(prev => prev.filter(i => i.id !== invitationId));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to cancel invitation');
		}
	};

	return (
		<>
			{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

			<Typography variant="h6" gutterBottom>My Organizations</Typography>
			<List>
				{orgs.map(org => (
					<ListItem key={org.id} divider>
						<ListItemText
							primary={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									{org.organizationName}
									{org.organizationId === currentOrgId && <Chip label="Current" size="small" color="primary" />}
									<Chip label={org.roleNames?.join(', ') || 'Member'} size="small" variant="outlined" />
								</Box>
							}
							secondary={org.organizationSubdomain}
						/>
						{org.organizationId !== currentOrgId && (
							<ListItemSecondaryAction>
								<Button
									size="small"
									variant="outlined"
									onClick={() => handleSwitch(org.organizationId)}
									disabled={switching === org.organizationId}
								>
									{switching === org.organizationId ? <CircularProgress size={16} /> : 'Switch'}
								</Button>
							</ListItemSecondaryAction>
						)}
					</ListItem>
				))}
			</List>

			{/* Invitations */}
			{canManageOrganizationAccess && currentOrgId && (
				<Box sx={{ mt: 4 }}>
					<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
						<Typography variant="h6">Pending Invitations</Typography>
						<Button variant="contained" size="small" onClick={() => setShowInvite(true)} disabled={!canInviteUsers || !canViewRoles}>
							Invite User
						</Button>
					</Box>

					{!canViewInvitations ? (
						<Typography color="text.secondary">Your account cannot view pending invitations in this organization.</Typography>
					) : invitations.length === 0 ? (
						<Typography color="text.secondary">No pending invitations</Typography>
					) : (
						<List>
							{invitations.map(inv => (
								<ListItem key={inv.id} divider>
									<ListItemText
										primary={inv.email}
										secondary={`Role: ${inv.roleName} • Expires: ${inv.expiresAt?.toLocaleDateString() || 'N/A'}`}
									/>
									<ListItemSecondaryAction>
										<IconButton edge="end" onClick={() => handleCancelInvitation(inv.id)} disabled={!canCancelInvitations}>
											<DeleteIcon />
										</IconButton>
									</ListItemSecondaryAction>
								</ListItem>
							))}
						</List>
					)}

					{/* Invite Dialog */}
					<Dialog open={showInvite} onClose={() => setShowInvite(false)}>
						<DialogTitle>Invite User</DialogTitle>
						<DialogContent>
							<TextField
								fullWidth
								label="Email"
								type="email"
								value={inviteEmail}
								onChange={(e) => setInviteEmail(e.target.value)}
								sx={{ mt: 1, mb: 2 }}
							/>
							<TextField
								select
								fullWidth
								label="Role"
								value={inviteRoleId}
								onChange={(e) => setInviteRoleId(e.target.value)}
								disabled={!canViewRoles || loadingRoles || availableRoles.length === 0}
								helperText={!canViewRoles ? 'Your account cannot view organization roles.' : loadingRoles ? 'Loading roles...' : availableRoles.length === 0 ? 'No roles available for this organization' : 'Choose the role that will be assigned when the invite is accepted'}
								SelectProps={{ native: true }}
							>
								{availableRoles.length === 0 ? (
									<option value="">No roles available</option>
								) : (
									availableRoles.map((role) => (
										<option key={role.id} value={role.id}>{role.name}</option>
									))
								)}
							</TextField>
						</DialogContent>
						<DialogActions>
							<Button onClick={() => setShowInvite(false)}>Cancel</Button>
							<Button variant="contained" onClick={handleInvite} disabled={inviting || !canInviteUsers || !canViewRoles || !inviteEmail || !inviteRoleId || loadingRoles}>
								{inviting ? <CircularProgress size={20} /> : 'Send Invitation'}
							</Button>
						</DialogActions>
					</Dialog>
				</Box>
			)}
		</>
	);
}
