/**
 * Scheduling Assistant
 * Attendee selector + free/busy grid + slot suggestions.
 * Feature: 026-calendar-system (T061)
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
	Box,
	Typography,
	Button,
	Chip,
	TextField,
	CircularProgress,
	List,
	ListItem,
	ListItemText,
	ListItemSecondaryAction,
	Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getFreeBusy, suggestSlots, type FreeBusySlot, type EmployeeFreeBusy } from 'apis';

// =============================================================================
// Types
// =============================================================================

interface SchedulingAssistantProps {
	selectedAttendeeIds: string[];
	durationMinutes: number;
	onSlotSelected?: (slot: FreeBusySlot) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function formatSlot(slot: FreeBusySlot): string {
	if (!slot.start || !slot.end) return '';
	const dateStr = slot.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	const startStr = slot.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const endStr = slot.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return `${dateStr}, ${startStr} – ${endStr}`;
}

// =============================================================================
// Component
// =============================================================================

export default function SchedulingAssistant({
	selectedAttendeeIds,
	durationMinutes,
	onSlotSelected,
}: SchedulingAssistantProps) {
	const [searchFrom] = useState(() => new Date());
	const searchUntil = useMemo(() => {
		const d = new Date(searchFrom);
		d.setDate(d.getDate() + 14);
		return d;
	}, [searchFrom]);

	const { data: freeBusy, isLoading: freeBusyLoading } = useQuery({
		queryKey: ['calendar', 'freeBusy', selectedAttendeeIds, searchFrom.toISOString()],
		queryFn: () => getFreeBusy(selectedAttendeeIds, searchFrom, searchUntil),
		enabled: selectedAttendeeIds.length > 0,
	});

	const { data: suggestions, isLoading: suggestLoading, refetch: refetchSuggestions } = useQuery({
		queryKey: ['calendar', 'suggestSlots', selectedAttendeeIds, durationMinutes],
		queryFn: () => suggestSlots(selectedAttendeeIds, durationMinutes, searchFrom, searchUntil, 5),
		enabled: false,
	});

	return (
		<Box data-testid="scheduling-assistant" sx={{ p: 2 }}>
			<Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
				Scheduling Assistant
			</Typography>

			{selectedAttendeeIds.length === 0 ? (
				<Typography variant="body2" color="text.secondary">
					Add attendees to see availability
				</Typography>
			) : (
				<>
					{/* Free/Busy Summary */}
					<Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
						{selectedAttendeeIds.length} attendee(s) &middot; {durationMinutes}min
					</Typography>

					{freeBusyLoading ? (
						<CircularProgress size={20} />
					) : (
						freeBusy && (
							<Box sx={{ mb: 2 }}>
								{freeBusy.map((fb) => (
									<Box key={fb.employeeId} sx={{ mb: 0.5 }}>
										<Typography variant="caption">
											{fb.employeeId.slice(0, 8)}… — {fb.slots.length} busy slot(s)
										</Typography>
									</Box>
								))}
							</Box>
						)
					)}

					{/* Suggest Button */}
					<Button
						size="small"
						variant="outlined"
						startIcon={<SearchIcon />}
						onClick={() => refetchSuggestions()}
						disabled={suggestLoading}
						sx={{ mb: 2, textTransform: 'none' }}
					>
						{suggestLoading ? 'Finding…' : 'Find Available Slots'}
					</Button>

					{/* Suggestions List */}
					{suggestions && suggestions.length > 0 && (
						<List dense disablePadding>
							{suggestions.map((slot, idx) => (
								<ListItem key={idx} divider>
									<ListItemText primary={formatSlot(slot)} />
									<ListItemSecondaryAction>
										<Button
											size="small"
											variant="text"
											startIcon={<CheckCircleIcon />}
											onClick={() => onSlotSelected?.(slot)}
											sx={{ textTransform: 'none' }}
										>
											Select
										</Button>
									</ListItemSecondaryAction>
								</ListItem>
							))}
						</List>
					)}

					{suggestions && suggestions.length === 0 && (
						<Typography variant="body2" color="text.secondary">
							No conflict-free slots found in the next 14 days.
						</Typography>
					)}
				</>
			)}
		</Box>
	);
}
