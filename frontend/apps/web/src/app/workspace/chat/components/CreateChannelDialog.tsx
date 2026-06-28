/**
 * Create Channel Dialog Component
 * Modal dialog for creating new chat channels
 * 
 * Features:
 * - Channel name input (required)
 * - Slug auto-generation from name
 * - Description textarea (optional)
 * - Private channel toggle
 * - Form validation
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	TextField,
	FormControlLabel,
	Switch,
	Box,
	Alert,
	CircularProgress,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createChannel } from 'apis';

interface CreateChannelDialogProps {
	open: boolean;
	onClose: () => void;
	onSuccess?: (channelId: string) => void;
}

/**
 * Generate a slug from channel name
 * Converts to lowercase, replaces spaces/special chars with hyphens
 */
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '') // Remove special characters
		.replace(/\s+/g, '-') // Replace spaces with hyphens
		.replace(/-+/g, '-') // Replace multiple hyphens with single
		.replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

export default function CreateChannelDialog({
	open,
	onClose,
	onSuccess,
}: CreateChannelDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState('');
	const [slug, setSlug] = useState('');
	const [description, setDescription] = useState('');
	const [isPrivate, setIsPrivate] = useState(false);
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

	// Auto-generate slug from name unless manually edited
	useEffect(() => {
		if (!slugManuallyEdited && name) {
			setSlug(generateSlug(name));
		}
	}, [name, slugManuallyEdited]);

	// Reset form when dialog opens/closes
	useEffect(() => {
		if (!open) {
			setName('');
			setSlug('');
			setDescription('');
			setIsPrivate(false);
			setSlugManuallyEdited(false);
		}
	}, [open]);

	const createChannelMutation = useMutation({
		mutationFn: createChannel,
		onSuccess: (response) => {
			// Invalidate recent channels query to refresh list
			queryClient.invalidateQueries({ queryKey: ['recentChannels'] });
			queryClient.invalidateQueries({ queryKey: ['userChatConfig'] });

			// Call success callback with new channel ID
			if (onSuccess && response.channel?.id) {
				onSuccess(response.channel.id);
			}

			onClose();
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (!name.trim() || !slug.trim()) {
			return;
		}

		createChannelMutation.mutate({
			slug,
			name: name.trim(),
			description: description.trim() || undefined,
			isPrivate,
		});
	};

	const handleSlugChange = (value: string) => {
		setSlug(value);
		setSlugManuallyEdited(true);
	};

	const isFormValid = name.trim().length > 0 && slug.trim().length > 0;

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<form onSubmit={handleSubmit}>
				<DialogTitle>Create Channel</DialogTitle>
				<DialogContent>
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
						{/* Channel Name */}
						<TextField
							label="Channel Name"
							placeholder="e.g., Engineering Updates"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							fullWidth
							autoFocus
							helperText="A friendly display name for your channel"
						/>

						{/* Channel Slug */}
						<TextField
							label="Channel Slug"
							placeholder="e.g., engineering-updates"
							value={slug}
							onChange={(e) => handleSlugChange(e.target.value)}
							required
							fullWidth
							helperText="URL-friendly identifier (lowercase, hyphens only)"
							inputProps={{
								pattern: '[a-z0-9-]+',
							}}
						/>

						{/* Description */}
						<TextField
							label="Description"
							placeholder="What is this channel about?"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							multiline
							rows={3}
							fullWidth
							helperText="Optional description to help people understand the channel's purpose"
						/>

						{/* Private Toggle */}
						<FormControlLabel
							control={
								<Switch
									checked={isPrivate}
									onChange={(e) => setIsPrivate(e.target.checked)}
								/>
							}
							label="Private channel"
						/>
						<Box sx={{ ml: 4, mt: -1, mb: 1 }}>
							<Box component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
								{isPrivate
									? 'Only invited members can view and join'
									: 'Anyone in your organization can view and join'}
							</Box>
						</Box>

						{/* Error Display */}
						{createChannelMutation.isError && (
							<Alert severity="error">
								Failed to create channel. Please try again.
							</Alert>
						)}
					</Box>
				</DialogContent>
				<DialogActions>
					<Button onClick={onClose} disabled={createChannelMutation.isPending}>
						Cancel
					</Button>
					<Button
						type="submit"
						variant="contained"
						disabled={!isFormValid || createChannelMutation.isPending}
						startIcon={createChannelMutation.isPending ? <CircularProgress size={16} /> : null}
					>
						{createChannelMutation.isPending ? 'Creating...' : 'Create Channel'}
					</Button>
				</DialogActions>
			</form>
		</Dialog>
	);
}
