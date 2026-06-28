/**
 * Booking Link Recipient Page
 * Shows available slots for a booking token, allows picking a slot.
 * Feature: 026-calendar-system (T063)
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
	Box,
	Typography,
	Button,
	CircularProgress,
	List,
	ListItem,
	ListItemText,
	Paper,
	Alert,
} from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getBookingLinkByToken, claimBookingSlot, type FreeBusySlot } from 'apis';

// =============================================================================
// Helpers
// =============================================================================

function formatSlot(slot: FreeBusySlot): string {
	if (!slot.start || !slot.end) return '';
	const dateStr = slot.start.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	});
	const startStr = slot.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const endStr = slot.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return `${dateStr} — ${startStr} to ${endStr}`;
}

// =============================================================================
// Page Component
// =============================================================================

export default function BookingPage() {
	const params = useParams<{ token: string }>();
	const token = params?.token ?? '';

	const { data, isLoading, error } = useQuery({
		queryKey: ['bookingLink', token],
		queryFn: () => getBookingLinkByToken(token),
		enabled: !!token,
	});

	const [confirmed, setConfirmed] = useState(false);

	const claimMutation = useMutation({
		mutationFn: (slotStart: Date) => claimBookingSlot(token, slotStart),
		onSuccess: () => setConfirmed(true),
	});

	const handleClaim = useCallback(
		(slot: FreeBusySlot) => {
			if (slot.start) {
				claimMutation.mutate(slot.start);
			}
		},
		[claimMutation],
	);

	if (isLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (error || !data) {
		return (
			<Box sx={{ p: 4 }}>
				<Alert severity="error">Booking link not found or expired.</Alert>
			</Box>
		);
	}

	if (confirmed) {
		return (
			<Box sx={{ p: 4, textAlign: 'center' }}>
				<EventAvailableIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
				<Typography variant="h5" sx={{ fontWeight: 600 }}>
					Meeting Confirmed!
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
					You&apos;ll receive a calendar invite shortly.
				</Typography>
			</Box>
		);
	}

	const { bookingLink, availableSlots } = data;

	return (
		<Box sx={{ maxWidth: 600, mx: 'auto', p: 3 }}>
			<Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
				{bookingLink.title}
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
				{bookingLink.durationMinutes} minutes
			</Typography>

			{availableSlots.length === 0 ? (
				<Alert severity="info">No available slots at this time.</Alert>
			) : (
				<>
					<Typography variant="subtitle2" sx={{ mb: 1 }}>
						Select a time:
					</Typography>
					<List disablePadding>
						{availableSlots.map((slot, idx) => (
							<Paper key={idx} variant="outlined" sx={{ mb: 1 }}>
								<ListItem>
									<ListItemText primary={formatSlot(slot)} />
									<Button
										size="small"
										variant="contained"
										onClick={() => handleClaim(slot)}
										disabled={claimMutation.isPending}
										sx={{ textTransform: 'none', ml: 1 }}
									>
										Book
									</Button>
								</ListItem>
							</Paper>
						))}
					</List>
				</>
			)}

			{claimMutation.isError && (
				<Alert severity="error" sx={{ mt: 2 }}>
					Failed to book this slot. It may have been claimed already.
				</Alert>
			)}
		</Box>
	);
}
