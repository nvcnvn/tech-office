/**
 * Invite Member Dialog Component
 * Dialog for inviting organization members to a channel
 * 
 * Features:
 * - Search employees by name or email
 * - Excludes employees already in the channel
 * - Handles invitation with optimistic UI updates
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	TextField,
	List,
	ListItemButton,
	ListItemText,
	ListItemAvatar,
	Avatar,
	CircularProgress,
	Typography,
	Box,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listEmployees } from 'apis';
import { inviteMember, listChannelMembers } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface EmployeeItem {
	id: string;
	givenName: string;
	familyName: string;
	email: string;
	role: string;
	isActive: boolean;
	roleNames: string[];
	isOrgManaged: boolean;
}

interface InviteMemberDialogProps {
	open: boolean;
	onClose: () => void;
	channelId: string;
	channelName: string;
}

export default function InviteMemberDialog({
	open,
	onClose,
	channelId,
	channelName,
}: InviteMemberDialogProps) {
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState('');
	const [pendingInvites, setPendingInvites] = useState<Set<string>>(new Set());
	const [inviteErrors, setInviteErrors] = useState<Map<string, string>>(new Map());
	const colors = useThemeColors();

	// Fetch all organization employees
	const { data: employeesData, isLoading: isLoadingEmployees } = useQuery({
		queryKey: ['employees', 'all'],
		queryFn: async () => {
			// Use a placeholder org ID - the backend will use the authenticated user's org
			const response = await listEmployees('placeholder-org-id', {
				pageNumber: 1,
				pageSize: 200, // Get a large batch for search
			});
			return response;
		},
		enabled: open,
	});

	// Fetch current channel members
	const { data: membersData, isLoading: isLoadingMembers } = useQuery({
		queryKey: ['channelMembers', channelId],
		queryFn: async () => {
			const response = await listChannelMembers({
				channelId,
				pageSize: 200,
			});
			return response;
		},
		enabled: open,
	});

	// Invite member mutation
	const inviteMutation = useMutation({
		mutationFn: async (employeeId: string) => {
			setPendingInvites(prev => new Set(prev).add(employeeId));
			return await inviteMember({
				channelId,
				employeeId,
			});
		},
		onSuccess: (_data, employeeId) => {
			// Invalidate queries to refresh data
			queryClient.invalidateQueries({ queryKey: ['channelMembers', channelId] });
			queryClient.invalidateQueries({ queryKey: ['recentChannels'] });

			// Remove from pending, clear any error
			setPendingInvites(prev => {
				const next = new Set(prev);
				next.delete(employeeId);
				return next;
			});
			setInviteErrors(prev => {
				const next = new Map(prev);
				next.delete(employeeId);
				return next;
			});
		},
		onError: (error: Error, employeeId) => {
			// Remove from pending, set error
			setPendingInvites(prev => {
				const next = new Set(prev);
				next.delete(employeeId);
				return next;
			});
			setInviteErrors(prev => new Map(prev).set(
				employeeId,
				error.message || 'Failed to invite member'
			));
		},
	});

	// Get member employee IDs set
	const memberEmployeeIds = useMemo(() => {
		if (!membersData?.memberships) return new Set<string>();
		return new Set(membersData.memberships.map((m) => m.employeeId));
	}, [membersData]);

	// Filter and search all employees
	const filteredEmployees = useMemo(() => {
		if (!employeesData?.employees) {
			return [];
		}

		return employeesData.employees.filter((emp: EmployeeItem) => {
			if (!searchQuery) return true;
			const query = searchQuery.toLowerCase();
			const fullName = `${emp.givenName} ${emp.familyName}`.toLowerCase();
			const email = emp.email.toLowerCase();
			return fullName.includes(query) || email.includes(query);
		});
	}, [employeesData, searchQuery]);

	// Separate members and non-members
	const { currentMembers, nonMembers } = useMemo(() => {
		const members: typeof filteredEmployees = [];
		const nonMems: typeof filteredEmployees = [];

		filteredEmployees.forEach((emp: EmployeeItem) => {
			if (memberEmployeeIds.has(emp.id)) {
				members.push(emp);
			} else {
				nonMems.push(emp);
			}
		});

		return { currentMembers: members, nonMembers: nonMems };
	}, [filteredEmployees, memberEmployeeIds]);

	const handleInvite = (employeeId: string) => {
		inviteMutation.mutate(employeeId);
	};

	const handleClose = () => {
		if (pendingInvites.size === 0) {
			setSearchQuery('');
			setPendingInvites(new Set());
			setInviteErrors(new Map());
			onClose();
		}
	};

	const isLoading = isLoadingEmployees || isLoadingMembers;

	return (
		<Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
			<DialogTitle>
				Channel Members - {channelName}
			</DialogTitle>
			<DialogContent>
				{isLoading ? (
					<Box className="flex items-center justify-center p-8">
						<CircularProgress size={32} />
					</Box>
				) : (
					<>
						{/* Search Bar */}
						<TextField
							autoFocus
							fullWidth
							size="small"
							placeholder="Search by name or email..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							sx={{ mb: 2 }}
							InputProps={{
								startAdornment: (
									<span className="text-gray-400 mr-2">🔍</span>
								),
							}}
						/>

						{/* Two-Column Layout */}
						<Box sx={{ display: 'flex', gap: 2, minHeight: '400px' }}>
							{/* Current Members (Left) */}
							<Box sx={{ flex: 1 }}>
								<Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
									Current Members ({currentMembers.length})
								</Typography>
								<List
									sx={{
										height: '380px',
										overflow: 'auto',
										border: '1px solid',
										borderColor: 'divider',
										borderRadius: 1,
										bgcolor: colors.bg.paper.className,
									}}
								>
									{currentMembers.length === 0 ? (
										<Box className="flex items-center justify-center h-full">
											<Typography variant="body2" color="text.secondary">
												No current members
											</Typography>
										</Box>
									) : (
										currentMembers.map((employee: EmployeeItem) => {
											const fullName = `${employee.givenName} ${employee.familyName}`;
											const initials = `${employee.givenName[0]}${employee.familyName[0]}`.toUpperCase();

											return (
												<ListItemButton key={employee.id} disabled sx={{ py: 1 }}>
													<ListItemAvatar>
														<Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
															{initials}
														</Avatar>
													</ListItemAvatar>
													<ListItemText
														primary={fullName}
														secondary={employee.email}
														primaryTypographyProps={{ variant: 'body2' }}
														secondaryTypographyProps={{ variant: 'caption' }}
													/>
													<Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
														✓
													</Typography>
												</ListItemButton>
											);
										})
									)}
								</List>
							</Box>

							{/* Add Members (Right) */}
							<Box sx={{ flex: 1 }}>
								<Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
									Add Members ({nonMembers.length})
								</Typography>
								<List
									sx={{
										height: '380px',
										overflow: 'auto',
										border: '1px solid',
										borderColor: 'divider',
										borderRadius: 1,
									}}
								>
									{nonMembers.length === 0 ? (
										<Box className="flex items-center justify-center h-full">
											<Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', px: 2 }}>
												{searchQuery
													? 'No non-member employees found'
													: 'All employees are already members'}
											</Typography>
										</Box>
									) : (
										nonMembers.map((employee: EmployeeItem) => {
											const fullName = `${employee.givenName} ${employee.familyName}`;
											const initials = `${employee.givenName[0]}${employee.familyName[0]}`.toUpperCase();
											const isPending = pendingInvites.has(employee.id);
											const error = inviteErrors.get(employee.id);

											return (
												<ListItemButton
													key={employee.id}
													onClick={() => !isPending && handleInvite(employee.id)}
													disabled={isPending}
													sx={{ py: 1 }}
												>
													<ListItemAvatar>
														<Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
															{initials}
														</Avatar>
													</ListItemAvatar>
													<ListItemText
														primary={
															<Box>
																<Typography variant="body2">{fullName}</Typography>
																{error && (
																	<Typography variant="caption" color="error">
																		{error}
																	</Typography>
																)}
															</Box>
														}
														secondary={employee.email}
														secondaryTypographyProps={{ variant: 'caption' }}
													/>
													<Button
														size="small"
														variant="outlined"
														disabled={isPending}
														onClick={(e) => {
															e.stopPropagation();
															handleInvite(employee.id);
														}}
													>
														{isPending ? (
															<>
																<CircularProgress size={14} sx={{ mr: 0.5 }} />
																Adding...
															</>
														) : (
															'Add'
														)}
													</Button>
												</ListItemButton>
											);
										})
									)}
								</List>
							</Box>
						</Box>
					</>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={pendingInvites.size > 0}>
					{pendingInvites.size > 0 ? 'Adding members...' : 'Close'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
