/**
 * Start Direct Message Dialog
 * Search employees and create/navigate to DM channel
 * 
 * Features:
 * - Real-time employee search with autocomplete
 * - Create new DM or navigate to existing one
 * - Shows employee names and emails
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
	CircularProgress,
	Typography,
	Box,
} from '@mui/material';
import { autocompleteEmployees, createOrGetDirectMessage, type EmployeeSuggestion } from 'apis';
import { UserCard } from '@/components/user';

interface StartDMDialogProps {
	open: boolean;
	onClose: () => void;
}

export default function StartDMDialog({ open, onClose }: StartDMDialogProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState('');
	const [suggestions, setSuggestions] = useState<EmployeeSuggestion[]>([]);
	const [isSearching, setIsSearching] = useState(false);

	// Mutation to create/get DM
	const createDMMutation = useMutation({
		mutationFn: createOrGetDirectMessage,
		onSuccess: (data) => {
			// Invalidate queries to refetch channel lists
			queryClient.invalidateQueries({ queryKey: ['recentChannels'] });
			queryClient.invalidateQueries({ queryKey: ['allChannels'] });
			queryClient.invalidateQueries({ queryKey: ['userChatConfig'] });

			// Navigate to the DM channel
			router.push(`/workspace/chat?channel=${data.channel.id}`);
			handleClose();
		},
	});

	// Handle search input change
	const handleSearchChange = async (query: string) => {
		setSearchQuery(query);

		if (query.trim().length < 2) {
			setSuggestions([]);
			return;
		}

		setIsSearching(true);
		try {
			const results = await autocompleteEmployees(query, 10);
			setSuggestions(results);
		} catch (error) {
			console.error('Failed to search employees:', error);
			setSuggestions([]);
		} finally {
			setIsSearching(false);
		}
	};

	const handleEmployeeSelect = (employeeId: string) => {
		createDMMutation.mutate(employeeId);
	};

	const handleClose = () => {
		setSearchQuery('');
		setSuggestions([]);
		onClose();
	};

	return (
		<Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
			<DialogTitle>Start Direct Message</DialogTitle>
			<DialogContent>
				<TextField
					autoFocus
					fullWidth
					placeholder="Search employees by name or email..."
					value={searchQuery}
					onChange={(e) => handleSearchChange(e.target.value)}
					disabled={createDMMutation.isPending}
					sx={{ mt: 1 }}
					InputProps={{
						endAdornment: isSearching && <CircularProgress size={20} />,
					}}
				/>

				{/* Employee suggestions */}
				{searchQuery.length >= 2 && (
					<Box sx={{ mt: 2 }}>
						{isSearching ? (
							<Box className="flex items-center justify-center p-4">
								<CircularProgress size={24} />
							</Box>
						) : suggestions.length === 0 ? (
							<Typography variant="body2" color="text.secondary" className="text-center p-4">
								No employees found
							</Typography>
						) : (
							<List>
								{suggestions.map((employee) => (
									<ListItemButton
										key={employee.id}
										onClick={() => handleEmployeeSelect(employee.id)}
										disabled={createDMMutation.isPending}
									>
										<UserCard
											employeeId={employee.id}
											userInfo={{
												givenName: employee.givenName,
												familyName: employee.familyName,
												email: employee.email,
											}}
											variant="standard"
											showPresence
											sx={{ flex: 1, py: 0.5 }}
										/>
									</ListItemButton>
								))}
							</List>
						)}
					</Box>
				)}

				{/* Loading state */}
				{createDMMutation.isPending && (
					<Box className="flex items-center justify-center p-4">
						<CircularProgress size={32} />
						<Typography variant="body2" className="ml-2">
							Opening conversation...
						</Typography>
					</Box>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={createDMMutation.isPending}>
					Cancel
				</Button>
			</DialogActions>
		</Dialog>
	);
}
