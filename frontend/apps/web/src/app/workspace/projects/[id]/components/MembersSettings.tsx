/**
 * MembersSettings Component - Project membership management
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - List all project members with role and join date
 * - Add new members via employee search
 * - Update member roles (owner, admin, member, viewer)
 * - Remove members from project
 * - Role-based permission display
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	Box,
	Typography,
	Button,
	IconButton,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Paper,
	Chip,
	Alert,
	CircularProgress,
	TextField,
	InputAdornment,
	List,
	ListItem,
	ListItemButton,
	Tooltip,
	Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import VisibilityIcon from '@mui/icons-material/Visibility';
import StarIcon from '@mui/icons-material/Star';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import { UserCard, usePopulateUserCache } from '@/components/user';
import {
	listProjectMembers,
	addProjectMember,
	updateProjectMemberRole,
	removeProjectMember,
	listEmployees,
	getEmployeeCards,
	type ProjectMember,
	type ProjectMemberRole,
} from 'apis';

// =============================================================================
// Role Configuration
// =============================================================================

const ROLE_OPTIONS: { value: ProjectMemberRole; label: string; icon: React.ReactNode; description: string }[] = [
	{ value: 'owner', label: 'Owner', icon: <StarIcon />, description: 'Full control, can delete project' },
	{ value: 'admin', label: 'Admin', icon: <AdminPanelSettingsIcon />, description: 'Manage members and settings' },
	{ value: 'member', label: 'Member', icon: <PersonIcon />, description: 'Create and edit tasks' },
	{ value: 'viewer', label: 'Viewer', icon: <VisibilityIcon />, description: 'View only access' },
];

const getRoleInfo = (role: ProjectMemberRole) => {
	return ROLE_OPTIONS.find((r) => r.value === role) || ROLE_OPTIONS[2];
};

const getRoleColor = (role: ProjectMemberRole): 'warning' | 'error' | 'primary' | 'default' => {
	switch (role) {
		case 'owner':
			return 'warning';
		case 'admin':
			return 'error';
		case 'member':
			return 'primary';
		case 'viewer':
		default:
			return 'default';
	}
};

// =============================================================================
// Add Member Dialog
// =============================================================================

interface AddMemberDialogProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (employeeId: string, role: ProjectMemberRole) => Promise<void>;
	existingMemberIds: string[];
}

function AddMemberDialog({
	open,
	onClose,
	onSubmit,
	existingMemberIds,
}: AddMemberDialogProps) {
	const colors = useThemeColors();
	const [searchQuery, setSearchQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
	const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('member');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Debounce the search query by 300 ms
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
		return () => clearTimeout(timer);
	}, [searchQuery]);

	// Fetch employees matching the search term
	const { data: searchResults, isFetching: isSearching } = useQuery({
		queryKey: ['memberSearch', debouncedQuery],
		queryFn: async () => {
			const resp = await listEmployees('', {
				emailFilter: debouncedQuery || undefined,
				pageNumber: 1,
				pageSize: 20,
			});
			return resp.employees;
		},
		enabled: open,
		placeholderData: (prev) => prev,
	});

	const candidates = (searchResults ?? []).filter(
		(emp) => !existingMemberIds.includes(emp.id),
	);

	const handleSubmit = async () => {
		if (!selectedEmployeeId) {
			setError('Please select an employee');
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSubmit(selectedEmployeeId, selectedRole);
			onClose();
			setSelectedEmployeeId('');
			setSearchQuery('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to add member');
		} finally {
			setSaving(false);
		}
	};

	const handleClose = () => {
		if (!saving) {
			onClose();
			setSelectedEmployeeId('');
			setSearchQuery('');
			setError(null);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="sm"
			fullWidth
			data-testid="add-member-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>Add Project Member</DialogTitle>
			<DialogContent sx={{ pb: 1 }}>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					{/* Employee search */}
					<TextField
						label="Search by name or email"
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							setSelectedEmployeeId(''); // clear selection on new search
						}}
						fullWidth
						disabled={saving}
						InputProps={{
							startAdornment: (
								<InputAdornment position="start">
									{isSearching ? <CircularProgress size={18} /> : <SearchIcon />}
								</InputAdornment>
							),
						}}
						data-testid="member-search-input"
					/>

					{/* Search results */}
					{candidates.length > 0 && !selectedEmployeeId && (
						<Paper
							variant="outlined"
							sx={{ maxHeight: 240, overflow: 'auto' }}
						>
							<List disablePadding>
								{candidates.map((emp, idx) => (
									<React.Fragment key={emp.id}>
										{idx > 0 && <Divider />}
										<ListItemButton
											onClick={() => setSelectedEmployeeId(emp.id)}
											data-testid={`candidate-${emp.id}`}
										>
											<UserCard
												employeeId={emp.id}
												userInfo={{ givenName: emp.givenName, familyName: emp.familyName, email: emp.email }}
												variant="standard"
											/>
										</ListItemButton>
									</React.Fragment>
								))}
							</List>
						</Paper>
					)}

					{/* Selected employee */}
					{selectedEmployeeId && (
						<Paper
							variant="outlined"
							sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
						>
							<Box sx={{ flex: 1 }}>
								<UserCard employeeId={selectedEmployeeId} variant="standard" />
							</Box>
							<Button
								size="small"
								onClick={() => { setSelectedEmployeeId(''); }}
								disabled={saving}
							>
								Change
							</Button>
						</Paper>
					)}

					{/* Role selector */}
					<FormControl fullWidth>
						<InputLabel>Role</InputLabel>
						<Select
							value={selectedRole}
							label="Role"
							onChange={(e) => setSelectedRole(e.target.value as ProjectMemberRole)}
							disabled={saving}
							data-testid="member-role-select"
						>
							{ROLE_OPTIONS.filter((r) => r.value !== 'owner').map((role) => (
								<MenuItem key={role.value} value={role.value}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										{role.icon}
										<Box>
											<Typography>{role.label}</Typography>
											<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
												{role.description}
											</Typography>
										</Box>
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={saving} data-testid="add-member-cancel">
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					variant="contained"
					disabled={saving || !selectedEmployeeId}
					data-testid="add-member-submit"
				>
					{saving ? <CircularProgress size={20} /> : 'Add Member'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Remove Member Confirmation Dialog
// =============================================================================

interface RemoveConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void>;
	memberToRemove: ProjectMember | null;
}

function RemoveConfirmDialog({
	open,
	onClose,
	onConfirm,
	memberToRemove,
}: RemoveConfirmDialogProps) {
	const colors = useThemeColors();
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		setRemoving(true);
		setError(null);

		try {
			await onConfirm();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to remove member');
		} finally {
			setRemoving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={() => !removing && onClose()}
			maxWidth="sm"
			fullWidth
			data-testid="remove-member-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>Remove Member</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<Alert severity="warning">
						Are you sure you want to remove this member from the project? They will lose
						access to all project tasks and data.
					</Alert>

					{memberToRemove && (
						<UserCard employeeId={memberToRemove.employeeId} variant="standard" />
					)}
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={removing} data-testid="remove-cancel">
					Cancel
				</Button>
				<Button
					onClick={handleConfirm}
					variant="contained"
					color="error"
					disabled={removing}
					data-testid="remove-confirm"
				>
					{removing ? <CircularProgress size={20} /> : 'Remove Member'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Main Members Settings Component
// =============================================================================

export default function MembersSettings() {
	const colors = useThemeColors();
	const { project, refreshProject } = useProjectContext();
	const [members, setMembers] = useState<ProjectMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
	const [updatingRoles, setUpdatingRoles] = useState<Set<string>>(new Set());
	const populateCache = usePopulateUserCache();

	// Load members and seed the user profile cache so UserCards render immediately
	const loadMembers = useCallback(async () => {
		if (!project) return;
		setLoading(true);
		try {
			const response = await listProjectMembers(project.id);
			setMembers(response.members);
			if (response.members.length > 0) {
				const ids = response.members.map((m) => m.employeeId);
				const cards = await getEmployeeCards(ids);
				populateCache(cards.map((c) => ({
					id: c.id,
					givenName: c.givenName,
					familyName: c.familyName,
					email: c.email,
					isActive: c.isActive,
					departmentName: c.departmentName,
				})));
			}
		} catch (err) {
			console.error('Failed to load members:', err);
		} finally {
			setLoading(false);
		}
	}, [project, populateCache]);

	useEffect(() => {
		loadMembers();
	}, [loadMembers]);

	const handleAddMember = useCallback(
		async (employeeId: string, role: ProjectMemberRole) => {
			if (!project) return;
			await addProjectMember(project.id, employeeId, role);
			await loadMembers();
			await refreshProject();
		},
		[project, loadMembers, refreshProject]
	);

	const handleRoleChange = useCallback(
		async (member: ProjectMember, newRole: ProjectMemberRole) => {
			if (!project) return;
			setUpdatingRoles((prev) => new Set(prev).add(member.employeeId));
			try {
				await updateProjectMemberRole(project.id, member.employeeId, newRole);
				await loadMembers();
			} catch (err) {
				console.error('Failed to update role:', err);
			} finally {
				setUpdatingRoles((prev) => {
					const next = new Set(prev);
					next.delete(member.employeeId);
					return next;
				});
			}
		},
		[project, loadMembers]
	);

	const handleRemoveMember = useCallback(async () => {
		if (!project || !memberToRemove) return;
		await removeProjectMember(project.id, memberToRemove.employeeId);
		await loadMembers();
		await refreshProject();
	}, [project, memberToRemove, loadMembers, refreshProject]);

	const openRemoveDialog = (member: ProjectMember) => {
		setMemberToRemove(member);
		setRemoveDialogOpen(true);
	};

	// Sort members: owners first, then admins, then members, then viewers
	const sortedMembers = [...members].sort((a, b) => {
		const order: Record<ProjectMemberRole, number> = {
			owner: 0,
			admin: 1,
			member: 2,
			viewer: 3,
		};
		return order[a.role] - order[b.role];
	});

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Box sx={{ p: 3 }} data-testid="members-settings">
			{/* Header */}
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
				<Box>
					<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
						Project Members
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Manage who has access to this project and their permissions
					</Typography>
				</Box>
				<Button
					variant="contained"
					startIcon={<AddIcon />}
					onClick={() => setAddDialogOpen(true)}
					data-testid="add-member-btn"
				>
					Add Member
				</Button>
			</Box>

			{/* Members List */}
			<List sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
				{sortedMembers.map((member) => {
					const roleInfo = getRoleInfo(member.role);
					const isUpdating = updatingRoles.has(member.employeeId);
					const isOwner = member.role === 'owner';

					return (
						<Paper
							key={member.id}
							sx={{
								...colors.bg.paper.style,
							}}
							data-testid={`member-item-${member.id}`}
						>
							<ListItem
								secondaryAction={
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<FormControl size="small" sx={{ minWidth: 120 }}>
											<Select
												value={member.role}
												onChange={(e) =>
													handleRoleChange(member, e.target.value as ProjectMemberRole)
												}
												disabled={isUpdating || isOwner}
												data-testid={`role-select-${member.id}`}
											>
												{ROLE_OPTIONS.map((role) => (
													<MenuItem
														key={role.value}
														value={role.value}
														disabled={role.value === 'owner'}
													>
														{role.label}
													</MenuItem>
												))}
											</Select>
										</FormControl>
										<Tooltip title={isOwner ? 'Cannot remove owner' : 'Remove member'}>
											<span>
												<IconButton
													size="small"
													onClick={() => openRemoveDialog(member)}
													disabled={isOwner}
													data-testid={`remove-member-${member.id}`}
												>
													<DeleteIcon fontSize="small" />
												</IconButton>
											</span>
										</Tooltip>
									</Box>
								}
							>
								<Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
									<UserCard employeeId={member.employeeId} variant="standard" />
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: '48px' }}>
										<Chip
											label={roleInfo.label}
											size="small"
											color={getRoleColor(member.role)}
											variant="outlined"
										/>
										<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
											Joined {member.joinedAt.toLocaleDateString()}
										</Typography>
									</Box>
								</Box>
							</ListItem>
						</Paper>
					);
				})}

				{sortedMembers.length === 0 && (
					<Alert severity="info">
						No members found. Click &quot;Add Member&quot; to invite team members.
					</Alert>
				)}
			</List>

			{/* Add Member Dialog */}
			<AddMemberDialog
				open={addDialogOpen}
				onClose={() => setAddDialogOpen(false)}
				onSubmit={handleAddMember}
				existingMemberIds={members.map((m) => m.employeeId)}
			/>

			{/* Remove Confirmation Dialog */}
			<RemoveConfirmDialog
				open={removeDialogOpen}
				onClose={() => setRemoveDialogOpen(false)}
				onConfirm={handleRemoveMember}
				memberToRemove={memberToRemove}
			/>
		</Box>
	);
}
