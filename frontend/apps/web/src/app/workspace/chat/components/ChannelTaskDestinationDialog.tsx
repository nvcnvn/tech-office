/**
 * ChannelTaskDestinationDialog — where this channel's tasks go.
 *
 * Feature: 038-chat-task-quick-action
 *
 * A channel's first conversion sets its destination automatically; this is how a channel
 * administrator changes or clears it afterwards. Changing it here changes the default for
 * everyone in the channel — picking a different project for a single conversion is done in
 * the create-task dialog and leaves this untouched.
 *
 * Web-only, per constitution principle XIII: mobile reads the destination and can override
 * it for one conversion, but administrative configuration stays here.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
	Alert,
	Autocomplete,
	Box,
	Button,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
	Typography,
	type TextFieldProps,
} from '@mui/material';
import {
	channelDestinationUnsetExplanation,
	getChannelTaskDestination,
	listProjects,
	setChannelTaskDestination,
	type ChannelTaskDestination,
	type Project,
} from 'apis';

interface ChannelTaskDestinationDialogProps {
	open: boolean;
	onClose: () => void;
	channelId: string;
	channelName: string;
}

export default function ChannelTaskDestinationDialog({
	open,
	onClose,
	channelId,
	channelName,
}: ChannelTaskDestinationDialogProps) {
	const [destination, setDestination] = useState<ChannelTaskDestination | null>(null);
	const [projects, setProjects] = useState<Project[]>([]);
	const [selected, setSelected] = useState<Project | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setError('');
		Promise.all([listProjects({ includeArchived: false }), getChannelTaskDestination(channelId)])
			.then(([projectResp, dest]) => {
				if (cancelled) return;
				const usable = projectResp.projects.filter((p) => !p.isArchived);
				setProjects(usable);
				setDestination(dest);
				setSelected(dest.isSet ? usable.find((p) => p.id === dest.projectId) ?? null : null);
			})
			.catch(() => {
				if (!cancelled) setError('Could not load the channel’s task destination.');
			});
		return () => {
			cancelled = true;
		};
	}, [open, channelId]);

	const save = useCallback(
		async (projectId?: string) => {
			setSaving(true);
			setError('');
			try {
				const updated = await setChannelTaskDestination(channelId, projectId);
				setDestination(updated);
				onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Could not save the destination. Try again.');
			} finally {
				setSaving(false);
			}
		},
		[channelId, onClose],
	);

	const unsetExplanation = destination?.isSet
		? undefined
		: channelDestinationUnsetExplanation(destination?.unsetReason);

	return (
		<Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" data-testid="channel-task-destination-dialog">
			<DialogTitle>Where {channelName}’s tasks go</DialogTitle>

			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}
					{unsetExplanation && <Alert severity="info">{unsetExplanation}</Alert>}

					<Autocomplete
						options={projects}
						value={selected}
						onChange={(_, value) => setSelected(value)}
						getOptionLabel={(option) => `${option.key} · ${option.name}`}
						isOptionEqualToValue={(a, b) => a.id === b.id}
						data-testid="channel-task-destination-project"
						renderInput={(params) => (
							<TextField
								{...(params as TextFieldProps)}
								label="Default project"
								placeholder="Tasks created here go to…"
							/>
						)}
					/>

					<Typography variant="caption" color="text.secondary">
						This is only a default. Anyone converting a message can send that one task
						somewhere else without changing it.
					</Typography>
				</Box>
			</DialogContent>

			<DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
				<Button
					onClick={() => void save(undefined)}
					disabled={saving || !destination?.isSet}
					data-testid="channel-task-destination-clear"
				>
					Clear
				</Button>
				<Box sx={{ display: 'flex', gap: 1 }}>
					<Button onClick={onClose} disabled={saving}>
						Cancel
					</Button>
					<Button
						variant="contained"
						onClick={() => selected && void save(selected.id)}
						disabled={saving || !selected}
						data-testid="channel-task-destination-save"
					>
						{saving ? <CircularProgress size={20} /> : 'Save'}
					</Button>
				</Box>
			</DialogActions>
		</Dialog>
	);
}
