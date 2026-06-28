'use client';

import React from 'react';
import { Paper, Box, Typography, Chip, Avatar } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import type { MessageSearchResult as MessageResult } from 'apis';

interface MessageSearchResultProps {
	message: MessageResult;
}

/**
 * Message search result card component
 * 
 * Displays message preview, channel context, and relevance score
 */
export default function MessageSearchResult({ message }: MessageSearchResultProps) {
	const handleClick = () => {
		// TODO: Navigate to message in channel context
		console.log('Navigate to message:', message.id, 'in channel:', message.channelId);
	};

	// Format timestamp
	const timeAgo = (date: Date) => {
		const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		return `${months}mo ago`;
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
				{/* Avatar */}
				<Avatar sx={{ bgcolor: 'success.main' }}>
					<ChatIcon />
				</Avatar>

				{/* Content */}
				<Box sx={{ flex: 1, minWidth: 0 }}>
					{/* Channel context */}
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
						<Typography variant="caption" color="text.secondary">
							{message.channelIsPrivate ? '🔒' : '#'} {message.channelName}
						</Typography>
						<Typography variant="caption" color="text.disabled">
							• {timeAgo(message.updatedAt)}
						</Typography>
						{message.isEdited && (
							<Chip label="edited" size="small" variant="outlined" sx={{ height: 18 }} />
						)}
					</Box>

					{/* Message preview */}
					<Typography
						variant="body2"
						sx={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							display: '-webkit-box',
							WebkitLineClamp: 3,
							WebkitBoxOrient: 'vertical',
							mb: 0.5,
						}}
					>
						{message.messageText}
					</Typography>

					{/* Reply indicator */}
					{message.parentMessageId && (
						<Typography variant="caption" color="text.disabled">
							↳ Reply
						</Typography>
					)}
				</Box>

				{/* Relevance Score */}
				<Chip
					label={`${Math.round(message.relevanceScore * 100)}%`}
					size="small"
					color="primary"
					variant="outlined"
				/>
			</Box>
		</Paper>
	);
}
