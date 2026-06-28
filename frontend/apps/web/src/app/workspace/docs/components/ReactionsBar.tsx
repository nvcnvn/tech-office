/**
 * ReactionsBar Component
 * Displays thumbs up/down reactions with counts
 * Shows user's current reaction and allows toggling
 * 
 * Features:
 * - Thumbs up/down buttons with counts
 * - User's current reaction highlighted
 * - Click to toggle reaction (add/remove/switch)
 */

'use client';

import React from 'react';
import { Box, IconButton, Typography, Tooltip } from '@mui/material';
import { ThumbUp as ThumbUpIcon, ThumbDown as ThumbDownIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getDocumentReactionStats,
	addDocumentReaction,
	removeDocumentReaction,
	type ReactionType,
} from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface ReactionsBarProps {
	documentId: string;
}

export default function ReactionsBar({ documentId }: ReactionsBarProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();

	// Fetch reaction stats
	const { data, isLoading } = useQuery({
		queryKey: ['docs', 'reactions', documentId],
		queryFn: () => getDocumentReactionStats(documentId),
		staleTime: 10000, // Refresh every 10s
	});

	// Add/switch reaction mutation
	const addMutation = useMutation({
		mutationFn: (reactionType: ReactionType) =>
			addDocumentReaction({ documentId, reactionType }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'reactions', documentId] });
		},
	});

	// Remove reaction mutation
	const removeMutation = useMutation({
		mutationFn: () => removeDocumentReaction(documentId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'reactions', documentId] });
		},
	});

	const thumbsUpCount = data?.thumbsUpCount || 0;
	const thumbsDownCount = data?.thumbsDownCount || 0;
	const userReaction = data?.userReaction;

	const handleThumbsUp = () => {
		if (userReaction === 'thumbs_up') {
			// Remove reaction if already thumbs up
			removeMutation.mutate();
		} else {
			// Add/switch to thumbs up
			addMutation.mutate('thumbs_up');
		}
	};

	const handleThumbsDown = () => {
		if (userReaction === 'thumbs_down') {
			// Remove reaction if already thumbs down
			removeMutation.mutate();
		} else {
			// Add/switch to thumbs down
			addMutation.mutate('thumbs_down');
		}
	};

	if (isLoading) {
		return null; // Or skeleton
	}

	const isPending = addMutation.isPending || removeMutation.isPending;

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				px: 2,
				py: 1.5,
				borderBottom: 1,
				...colors.border.default.style,
				...colors.bg.paper.style,
			}}
			data-testid="doc-reactions-bar"
		>
			<Typography variant="body2" sx={{ ...colors.text.secondary.style, mr: 1 }}>
				Feedback:
			</Typography>

			{/* Thumbs Up */}
			<Tooltip title={userReaction === 'thumbs_up' ? 'Remove thumbs up' : 'Thumbs up'}>
				<Box sx={{ display: 'flex', alignItems: 'center' }}>
					<IconButton
						onClick={handleThumbsUp}
						disabled={isPending}
						size="small"
						color={userReaction === 'thumbs_up' ? 'primary' : 'default'}
						data-testid="doc-thumbs-up-btn"
						sx={{
							...(userReaction === 'thumbs_up' && {
								bgcolor: 'action.selected',
							}),
						}}
					>
						<ThumbUpIcon fontSize="small" />
					</IconButton>
					<Typography
						variant="body2"
						sx={{
							...colors.text.secondary.style,
							minWidth: 20,
							textAlign: 'center',
						}}
					>
						{thumbsUpCount}
					</Typography>
				</Box>
			</Tooltip>

			{/* Thumbs Down */}
			<Tooltip title={userReaction === 'thumbs_down' ? 'Remove thumbs down' : 'Thumbs down'}>
				<Box sx={{ display: 'flex', alignItems: 'center' }}>
					<IconButton
						onClick={handleThumbsDown}
						disabled={isPending}
						size="small"
						color={userReaction === 'thumbs_down' ? 'error' : 'default'}
						data-testid="doc-thumbs-down-btn"
						sx={{
							...(userReaction === 'thumbs_down' && {
								bgcolor: 'error.light',
								'&:hover': {
									bgcolor: 'error.main',
								},
							}),
						}}
					>
						<ThumbDownIcon fontSize="small" />
					</IconButton>
					<Typography
						variant="body2"
						sx={{
							...colors.text.secondary.style,
							minWidth: 20,
							textAlign: 'center',
						}}
					>
						{thumbsDownCount}
					</Typography>
				</Box>
			</Tooltip>
		</Box>
	);
}
