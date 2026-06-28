'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Paper, Box, Chip } from '@mui/material';
import { createOrGetDirectMessage, type EmployeeSearchResult as EmployeeResult } from 'apis';
import { UserCard } from '@/components/user';

interface EmployeeSearchResultProps {
	employee: EmployeeResult;
}

/**
 * Employee search result card component
 * 
 * Displays employee name, email, and relevance score
 */
export default function EmployeeSearchResult({ employee }: EmployeeSearchResultProps) {
	const router = useRouter();
	const queryClient = useQueryClient();

	const handleClick = async () => {
		try {
			const result = await createOrGetDirectMessage(employee.id);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['recentChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['allChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['userChatConfig'] }),
			]);
			router.push(`/workspace/chat?channel=${result.channel.id}`);
		} catch (error) {
			console.error('Failed to create/get DM from search results:', error);
		}
	};

	return (
		<Paper
			sx={{
				p: 2,
				cursor: 'pointer',
				transition: 'border-color 0.2s',
				'&:hover': {
					borderColor: 'text.disabled',
				},
			}}
			onClick={handleClick}
		>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
				<UserCard
					employeeId={employee.id}
					userInfo={{
						givenName: employee.givenName,
						familyName: employee.familyName,
						email: employee.email,
						isActive: employee.isActive,
					}}
					variant="standard"
					showPresence
					sx={{ flex: 1, minWidth: 0 }}
				/>

				{/* Relevance Score */}
				<Chip
					label={`${Math.round(employee.relevanceScore * 100)}%`}
					size="small"
					color="primary"
					variant="outlined"
				/>
			</Box>
		</Paper>
	);
}
