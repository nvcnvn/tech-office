/**
 * Booking Link Modal
 * Configure available windows, duration, date range; generate link; copy-to-clipboard.
 * Feature: 026-calendar-system (T062)
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
	Box,
	Typography,
	Button,
	TextField,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	IconButton,
	Chip,
	Snackbar,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import { useMutation } from '@tanstack/react-query';
import { createBookingLink, type BookingWindow } from 'apis';
import { useAuthState } from '@/lib/auth/hooks';

// =============================================================================
// Types
// =============================================================================

interface BookingLinkModalProps {
	open: boolean;
	onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export default function BookingLinkModal({ open, onClose }: BookingLinkModalProps) {
	const { user } = useAuthState();
	const [title, setTitle] = useState('');
	const [durationMinutes, setDurationMinutes] = useState(30);
	const [validFrom, setValidFrom] = useState('');
	const [validUntil, setValidUntil] = useState('');
	const [shareUrl, setShareUrl] = useState('');
	const [bookingLinkId, setBookingLinkId] = useState('');
	const [copied, setCopied] = useState(false);

	const currentMembership = useMemo(
		() => user?.organizations.find((org) => org.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);

	const createMutation = useMutation({
		mutationFn: () => createBookingLink(title, durationMinutes, validFrom, validUntil),
		onSuccess: (data) => {
			setShareUrl(data.shareUrl);
			setBookingLinkId(data.bookingLink?.id ?? '');
		},
	});

	const handleCreate = useCallback(() => {
		createMutation.mutate();
	}, [createMutation]);

	const handleCopy = useCallback(async () => {
		if (!shareUrl) return;
		try {
			if (bookingLinkId && currentMembership?.organizationSubdomain) {
				const response = await fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							target: {
								tenantKey: currentMembership.organizationSubdomain,
								resourceType: 'booking',
								resourceId: bookingLinkId,
							},
						}),
					}
				);
				const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
				if (response.ok && payload?.canonicalUrl) {
					await navigator.clipboard.writeText(payload.canonicalUrl);
					setCopied(true);
					return;
				}
			}
		} catch {
			// fall through to shareUrl fallback
		}
		await navigator.clipboard.writeText(shareUrl);
		setCopied(true);
	}, [shareUrl, bookingLinkId, currentMembership]);

	return (
		<Dialog
			open={open}
			onClose={onClose}
			maxWidth="sm"
			fullWidth
			data-testid="booking-link-modal"
		>
			<DialogTitle>Create Booking Link</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					<TextField
						label="Title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						size="small"
						fullWidth
						placeholder="e.g., 30-minute 1:1"
					/>
					<TextField
						label="Duration (minutes)"
						type="number"
						value={durationMinutes}
						onChange={(e) => setDurationMinutes(Number(e.target.value))}
						size="small"
						inputProps={{ min: 5, max: 480 }}
					/>
					<Box sx={{ display: 'flex', gap: 2 }}>
						<TextField
							label="Valid from"
							type="date"
							value={validFrom}
							onChange={(e) => setValidFrom(e.target.value)}
							size="small"
							InputLabelProps={{ shrink: true }}
							sx={{ flex: 1 }}
						/>
						<TextField
							label="Valid until"
							type="date"
							value={validUntil}
							onChange={(e) => setValidUntil(e.target.value)}
							size="small"
							InputLabelProps={{ shrink: true }}
							sx={{ flex: 1 }}
						/>
					</Box>

					{shareUrl && (
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
							<LinkIcon color="primary" />
							<Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-all' }}>
								{shareUrl}
							</Typography>
							<IconButton size="small" onClick={handleCopy}>
								<ContentCopyIcon fontSize="small" />
							</IconButton>
						</Box>
					)}
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Close</Button>
				{!shareUrl && (
					<Button
						variant="contained"
						onClick={handleCreate}
						disabled={!title || !validFrom || !validUntil || createMutation.isPending}
					>
						{createMutation.isPending ? 'Creating…' : 'Generate Link'}
					</Button>
				)}
			</DialogActions>

			<Snackbar
				open={copied}
				autoHideDuration={2000}
				onClose={() => setCopied(false)}
				message="Link copied to clipboard"
			/>
		</Dialog>
	);
}
