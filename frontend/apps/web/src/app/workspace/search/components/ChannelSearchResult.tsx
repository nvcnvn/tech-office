'use client';

import React from 'react';
import { Paper, Box, Typography, Chip } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import TagIcon from '@mui/icons-material/Tag';
import type { ChannelSearchResult as ChannelResult } from 'apis';

interface ChannelSearchResultProps {
	channel: ChannelResult;
}

/**
 * Channel search result card component
 * 
 * Displays channel name, description, privacy status, and relevance score
 */
export default function ChannelSearchResult({ channel }: ChannelSearchResultProps) {
	const handleClick = () => {
		// TODO: Navigate to channel page
		console.log('Navigate to channel:', channel.id);
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
			<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
				{/* Icon */}
				<Box
					sx={{
						p: 1,
						borderRadius: 1,
						bgcolor: channel.isPrivate ? 'warning.light' : 'info.light',
						color: channel.isPrivate ? 'warning.contrastText' : 'info.contrastText',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{channel.isPrivate ? <LockIcon /> : <TagIcon />}
				</Box>

				{/* Content */}
				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
						<Typography variant="body1" fontWeight="medium" noWrap>
							{channel.isPrivate ? '🔒 ' : '# '}
							{channel.displayName}
						</Typography>
						{channel.isPrivate && (
							<Chip label="Private" size="small" color="warning" variant="outlined" />
						)}
					</Box>
					{channel.description && (
						<Typography
							variant="body2"
							color="text.secondary"
							sx={{
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								display: '-webkit-box',
								WebkitLineClamp: 2,
								WebkitBoxOrient: 'vertical',
							}}
						>
							{channel.description}
						</Typography>
					)}
				</Box>

				{/* Relevance Score */}
				<Chip
					label={`${Math.round(channel.relevanceScore * 100)}%`}
					size="small"
					color="primary"
					variant="outlined"
				/>
			</Box>
		</Paper>
	);
}
