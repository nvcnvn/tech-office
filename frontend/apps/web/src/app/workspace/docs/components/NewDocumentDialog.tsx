/**
 * NewDocumentDialog Component
 * Dialog for creating a new document
 */

'use client';

import React, { useState } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	TextField,
	Button,
	FormControl,
	InputLabel,
	Select,
	MenuItem,
	CircularProgress,
	Alert,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createDocument, type DocumentVisibility } from 'apis';

interface NewDocumentDialogProps {
	open: boolean;
	parentDocumentId?: string;
	onClose: () => void;
	onCreated: (createdDocumentId: string) => void;
}

export default function NewDocumentDialog({
	open,
	parentDocumentId,
	onClose,
	onCreated,
}: NewDocumentDialogProps) {
	const queryClient = useQueryClient();
	const [title, setTitle] = useState('');
	const [visibility, setVisibility] = useState<DocumentVisibility>('private');
	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		mutationFn: () =>
			createDocument({
				title: title.trim(),
				contentJson: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: '' }],
						},
					],
				}),
				parentDocumentId,
				visibility,
			}),
		onSuccess: (resp) => {
			queryClient.invalidateQueries({ queryKey: ['docs'] });
			setTitle('');
			setVisibility('private');
			setError(null);
			onCreated(resp.document.id);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to create document');
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) {
			setError('Title is required');
			return;
		}
		createMutation.mutate();
	};

	const handleClose = () => {
		setTitle('');
		setVisibility('private');
		setError(null);
		onClose();
	};

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="sm"
			fullWidth
			PaperProps={{
				component: 'form',
				onSubmit: handleSubmit,
			}}
		>
			<DialogTitle>
				{parentDocumentId ? 'New Sub-Document' : 'New Document'}
			</DialogTitle>

			<DialogContent>
				{error && (
					<Alert severity="error" sx={{ mb: 2 }}>
						{error}
					</Alert>
				)}

				<TextField
					autoFocus
					required
					fullWidth
					label="Title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					margin="normal"
					disabled={createMutation.isPending}
					data-testid="new-doc-title-input"
				/>

				{!parentDocumentId && (
					<FormControl fullWidth margin="normal">
						<InputLabel>Visibility</InputLabel>
						<Select
							value={visibility}
							label="Visibility"
							onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
							disabled={createMutation.isPending}
							data-testid="new-doc-visibility-select"
						>
							<MenuItem value="private">Private (invite only)</MenuItem>
							<MenuItem value="public">Public (organization-wide)</MenuItem>
						</Select>
					</FormControl>
				)}
			</DialogContent>

			<DialogActions>
				<Button onClick={handleClose} disabled={createMutation.isPending}>
					Cancel
				</Button>
				<Button
					type="submit"
					variant="contained"
					disabled={createMutation.isPending || !title.trim()}
					data-testid="new-doc-create-btn"
				>
					{createMutation.isPending ? (
						<CircularProgress size={20} />
					) : (
						'Create'
					)}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
